import json
import logging
import os
from copy import copy

import anyio
import mcp.types as types
from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from pydantic import ValidationError

logger = logging.getLogger(__name__)
log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logger.setLevel(getattr(logging, log_level, logging.INFO))
logger.addHandler(logging.StreamHandler())


def stdio_server_adapter(server_params: StdioServerParameters, event, context):
    try:
        logger.debug("Request: %s", json.dumps(event))
        result = anyio.run(handle_request, server_params, event, context)
        logger.debug("Result: %s", json.dumps(result))
        return result
    except ExceptionGroup as eg:
        error = unwrap_exception_group(eg)
        logger.error("Exception from exception group: %s", error, exc_info=error)
        raise error
    except BaseException as error:
        logger.error("General exception: %s", error, exc_info=True)
        return types.JSONRPCError(
            jsonrpc="2.0",
            id=0,
            error=types.ErrorData(
                code=500,
                message="Internal failure, please check Lambda function logs",
            ),
        ).model_dump(by_alias=True, mode="json", exclude_none=True)


async def handle_request(server_params: StdioServerParameters, event, context):
    # Determine the type of the request
    try:
        types.JSONRPCRequest.model_validate_json(json.dumps(event))
        return await handle_json_rpc_request(server_params, event, context)
    except ValidationError:
        try:
            types.JSONRPCNotification.model_validate_json(json.dumps(event))
            return await handle_json_rpc_notification(server_params, event, context)
        except ValidationError:
            return types.JSONRPCError(
                jsonrpc=event["jsonrpc"] if "jsonrpc" in event else "2.0",
                id=event["id"] if "id" in event else 0,
                error=types.ErrorData(
                    code=400,
                    message="Request is neither a valid JSON-RPC request nor a valid JSON-RPC notification",
                ),
            ).model_dump(by_alias=True, mode="json", exclude_none=True)


async def handle_json_rpc_notification(server_params, event, context):
    # Ignore notifications
    logger.debug("Ignoring notification")
    return {}


async def handle_json_rpc_request(server_params: StdioServerParameters, event, context):
    # Drop the JSON-RPC specific keys
    request = copy(event)
    jsonrpc = request.pop("jsonrpc", None)
    id = request.pop("id", None)

    try:
        # Start the stdio server locally and connect to it
        async with stdio_client(server_params) as streams:
            async with ClientSession(*streams) as session:
                await session.initialize()

                # Forward the request to the local stdio server
                result = await session.send_request(
                    request=types.ClientRequest(request),
                    result_type=types.Result,
                )

                result = result.model_dump(
                    by_alias=True, mode="json", exclude_none=True
                )

                return types.JSONRPCResponse(
                    jsonrpc=jsonrpc,
                    id=id,
                    result=result,
                ).model_dump(by_alias=True, mode="json", exclude_none=True)
    except ExceptionGroup as eg:
        error = unwrap_exception_group(eg)
        logger.error("Exception from exception group: %s", error, exc_info=error)
        return types.JSONRPCError(
            jsonrpc=jsonrpc,
            id=id,
            error=types.ErrorData(
                code=500,
                message="Internal failure, please check Lambda function logs",
            ),
        ).model_dump(by_alias=True, mode="json", exclude_none=True)
    except Exception as error:
        logger.error("General exception: %s", error, exc_info=True)
        return types.JSONRPCError(
            jsonrpc=jsonrpc,
            id=id,
            error=types.ErrorData(
                code=500,
                message="Internal failure, please check Lambda function logs",
            ),
        ).model_dump(by_alias=True, mode="json", exclude_none=True)


# Task groups created with "async with" and anyio will raise unhandled exceptions as an ExceptionGroup.
# Typically in our usage of task groups here, we only have one task and there is only one child exception.
# This method unwraps one or more child exceptions and returns the leaf exception,
# as long as it is the only child exception in the ExceptionGroup.
def unwrap_exception_group(eg: ExceptionGroup) -> Exception:
    if len(eg.exceptions) > 1 or len(eg.exceptions) == 0:
        return eg

    child = eg.exceptions[0]

    if isinstance(child, ExceptionGroup):
        return unwrap_exception_group(child)
    return child
