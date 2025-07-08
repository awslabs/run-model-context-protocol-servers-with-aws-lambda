from unittest.mock import patch

from mcp.client.stdio import StdioServerParameters
from mcp.shared.exceptions import McpError
from mcp.types import (
    ErrorData,
    JSONRPCError,
    JSONRPCMessage,
    JSONRPCNotification,
    JSONRPCRequest,
    JSONRPCResponse,
)

from mcp_lambda import stdio_server_adapter

server_params = StdioServerParameters(
    command="python",
    args=["tests/minimal_mcp_server/echo_server.py"],
)


def test_success_ping():
    request = JSONRPCMessage(root=JSONRPCRequest(jsonrpc="2.0", id=1, method="ping"))
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    response_obj = stdio_server_adapter(server_params, request_obj, {})
    response = JSONRPCMessage.model_validate(response_obj)

    assert response == JSONRPCMessage(
        root=JSONRPCResponse(jsonrpc="2.0", id=1, result={})
    )


def test_success_initialize():
    request = JSONRPCMessage(
        root=JSONRPCRequest(
            jsonrpc="2.0",
            id=1,
            method="initialize",
            params={
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "mcp", "version": "0.1.0"},
            },
        )
    )
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    response_obj = stdio_server_adapter(server_params, request_obj, {})
    response = JSONRPCMessage.model_validate(response_obj)

    assert isinstance(response.root, JSONRPCResponse)
    assert response.root.jsonrpc == "2.0"
    assert response.root.id == 1
    assert response.root.result


def test_success_list_tools():
    request = JSONRPCMessage(
        root=JSONRPCRequest(jsonrpc="2.0", id=1, method="tools/list")
    )
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    response_obj = stdio_server_adapter(server_params, request_obj, {})
    response = JSONRPCMessage.model_validate(response_obj)

    assert response == JSONRPCMessage(
        root=JSONRPCResponse(
            jsonrpc="2.0",
            id=1,
            result={
                "tools": [
                    {
                        "name": "echo",
                        "description": "Echo back the provided message",
                        "inputSchema": {
                            "properties": {
                                "message": {"title": "Message", "type": "string"}
                            },
                            "required": ["message"],
                            "title": "echoArguments",
                            "type": "object",
                        },
                        "outputSchema": {
                            "properties": {
                                "result": {"title": "Result", "type": "string"}
                            },
                            "required": ["result"],
                            "title": "echoOutput",
                            "type": "object",
                        },
                    }
                ]
            },
        )
    )


def test_success_call_tool():
    request = JSONRPCMessage(
        root=JSONRPCRequest(
            jsonrpc="2.0",
            id=1,
            method="tools/call",
            params={
                "name": "echo",
                "arguments": {
                    "message": "Hello world",
                },
            },
        )
    )
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    response_obj = stdio_server_adapter(server_params, request_obj, {})
    response = JSONRPCMessage.model_validate(response_obj)

    assert response == JSONRPCMessage(
        root=JSONRPCResponse(
            jsonrpc="2.0",
            id=1,
            result={
                "content": [{"type": "text", "text": "Echo: Hello world"}],
                "structuredContent": {"result": "Echo: Hello world"},
                "isError": False,
            },
        )
    )


def test_success_notification():
    request = JSONRPCMessage(
        root=JSONRPCNotification(
            jsonrpc="2.0",
            method="notifications/initialized",
        )
    )
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    response_obj = stdio_server_adapter(server_params, request_obj, {})

    assert response_obj == {}


def test_fail_invalid_request():
    request_obj = {"hello": "world"}

    response_obj = stdio_server_adapter(server_params, request_obj, {})
    response = JSONRPCMessage.model_validate(response_obj)

    assert response == JSONRPCMessage(
        root=JSONRPCError(
            jsonrpc="2.0",
            id=0,
            error=ErrorData(
                code=400,
                message="Request is neither a valid JSON-RPC request nor a valid JSON-RPC notification",
            ),
        )
    )


def test_fail_invalid_server_params():
    server_params = StdioServerParameters(
        command="does_not_exist",
    )

    request = JSONRPCMessage(root=JSONRPCRequest(jsonrpc="2.0", id=1, method="ping"))
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    response_obj = stdio_server_adapter(server_params, request_obj, {})
    response = JSONRPCMessage.model_validate(response_obj)

    assert response == JSONRPCMessage(
        root=JSONRPCError(
            jsonrpc="2.0",
            id=1,
            error=ErrorData(
                code=500,
                message="Internal failure, please check Lambda function logs",
            ),
        )
    )


def test_fail_server_misbehavior():
    # This 'server' responds back to the "initialize" request with a
    # copy of the initialize request. It is not valid behavior for the
    # server to send an initialize request to the client.
    server_params = StdioServerParameters(
        command="tee",
    )

    request = JSONRPCMessage(root=JSONRPCRequest(jsonrpc="2.0", id=1, method="ping"))
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    response_obj = stdio_server_adapter(server_params, request_obj, {})
    response = JSONRPCMessage.model_validate(response_obj)

    assert response == JSONRPCMessage(
        root=JSONRPCError(
            jsonrpc="2.0",
            id=1,
            error=ErrorData(
                code=500,
                message="Internal failure, please check Lambda function logs",
            ),
        )
    )


def test_fail_unknown_tool_call():
    request = JSONRPCMessage(
        root=JSONRPCRequest(
            jsonrpc="2.0",
            id=1,
            method="tools/call",
            params={
                "name": "does_not_exist",
                "arguments": {
                    "message": "Hello world",
                },
            },
        )
    )
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    response_obj = stdio_server_adapter(server_params, request_obj, {})
    response = JSONRPCMessage.model_validate(response_obj)

    assert response == JSONRPCMessage(
        root=JSONRPCResponse(
            jsonrpc="2.0",
            id=1,
            result={
                "content": [{"type": "text", "text": "Unknown tool: does_not_exist"}],
                "isError": True,
            },
        )
    )


def test_fail_server_returns_mcp_error():
    request = JSONRPCMessage(
        root=JSONRPCRequest(
            jsonrpc="2.0",
            id=1,
            method="tools/call",
            params={
                "name": "return_error",
                "arguments": {
                    "message": "Hello world",
                },
            },
        )
    )
    request_obj = request.model_dump(by_alias=True, exclude_none=True)

    with patch(
        "mcp.client.session.ClientSession.send_request",
        side_effect=McpError(
            error=ErrorData(
                code=400,
                message="Mocked error",
            ),
        ),
    ):
        response_obj = stdio_server_adapter(server_params, request_obj, {})
        response = JSONRPCMessage.model_validate(response_obj)

        assert response == JSONRPCMessage(
            root=JSONRPCError(
                jsonrpc="2.0",
                id=1,
                error=ErrorData(
                    code=500,
                    message="Internal failure, please check Lambda function logs",
                ),
            )
        )
