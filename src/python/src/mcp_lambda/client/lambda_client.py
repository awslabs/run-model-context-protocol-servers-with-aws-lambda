import logging
from contextlib import asynccontextmanager

import anyio
import anyio.lowlevel
import mcp.types as types
from aiobotocore.session import get_session
from anyio.streams.memory import MemoryObjectReceiveStream, MemoryObjectSendStream
from mcp.shared.message import SessionMessage
from pydantic import BaseModel


class LambdaFunctionParameters(BaseModel):
    function_name: str
    """The name or ARN of the Lambda function, version, or alias."""

    region_name: str
    """The AWS region of the Lambda function."""


@asynccontextmanager
async def lambda_function_client(lambda_function: LambdaFunctionParameters):
    """
    Client transport for Lambda functions: this will invoke a Lambda function
    when requests are sent to the client.
    """
    read_stream: MemoryObjectReceiveStream[SessionMessage | Exception]
    read_stream_writer: MemoryObjectSendStream[SessionMessage | Exception]

    write_stream: MemoryObjectSendStream[SessionMessage]
    write_stream_reader: MemoryObjectReceiveStream[SessionMessage]

    read_stream_writer, read_stream = anyio.create_memory_object_stream(0)
    write_stream, write_stream_reader = anyio.create_memory_object_stream(0)

    lambda_session = get_session()

    # MCP clients generally assume there is a read stream and a write stream.
    # When messages are received on the write stream, they are forwarded to the
    # Lambda function via Invoke API. The function response is written
    # to the read stream.
    async def invoke_function():
        try:
            async with lambda_session.create_client(
                "lambda", region_name=lambda_function.region_name
            ) as lambda_client:
                async with write_stream_reader:
                    async for session_message in write_stream_reader:
                        message = session_message.message
                        logging.debug(
                            f"MCP JSON RPC message raw: {message.__class__.__name__} {message}"
                        )
                        message_dict = message.model_dump(
                            by_alias=True, exclude_none=True
                        )
                        message_json = message.model_dump_json(
                            by_alias=True, exclude_none=True
                        )
                        logging.debug(f"MCP JSON RPC message JSON: {message_json}")

                        try:
                            logging.debug(
                                f"Invoking function: {lambda_function.function_name}"
                            )
                            function_response = await lambda_client.invoke(
                                FunctionName=lambda_function.function_name,
                                InvocationType="RequestResponse",
                                Payload=message_json.encode(
                                    encoding="utf-8", errors="strict"
                                ),
                            )

                            logging.debug(
                                f"Lambda function response: {function_response}"
                            )

                            async with function_response["Payload"] as stream:
                                payload = await stream.read()
                                response_payload = payload.decode(
                                    encoding="utf-8", errors="strict"
                                )
                                logging.debug(
                                    f"Lambda function response payload: {response_payload}"
                                )

                                if (
                                    "FunctionError" in function_response
                                    and function_response["FunctionError"]
                                ):
                                    raise Exception(
                                        f"Function invoke returned a function error: "
                                        f"{function_response.get('FunctionError')} - {response_payload}"
                                    )

                                if response_payload == "{}":
                                    # Assume we sent a notification and do not expect a response
                                    continue

                                response_message = (
                                    types.JSONRPCMessage.model_validate_json(
                                        response_payload
                                    )
                                )
                        except Exception as exc:
                            logging.debug(exc)
                            if "jsonrpc" in message_dict and "id" in message_dict:
                                error_message = types.JSONRPCMessage(
                                    types.JSONRPCError(
                                        jsonrpc=message_dict["jsonrpc"],
                                        id=message_dict["id"],
                                        error=types.ErrorData(
                                            code=500,
                                            message=str(exc),
                                        ),
                                    )
                                )
                                await read_stream_writer.send(
                                    SessionMessage(error_message)
                                )
                            else:
                                await read_stream_writer.send(exc)
                            continue

                        session_message = SessionMessage(response_message)
                        await read_stream_writer.send(session_message)
        except anyio.ClosedResourceError:
            await anyio.lowlevel.checkpoint()
        except Exception as exc:
            logging.exception(exc)
            raise

    async with anyio.create_task_group() as tg:
        tg.start_soon(invoke_function)
        yield read_stream, write_stream
