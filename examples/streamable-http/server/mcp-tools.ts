import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

// MCP Tools Registration - Contains all available tools for the MCP server

// Calculator Tool - Performs basic arithmetic operations
const calculatorToolName = 'calculate';
const calculatorToolDescription = 'Performs basic arithmetic operations (add, subtract, multiply, divide).';

const calculatorParamShape = {
  operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('The arithmetic operation to perform'),
  operandA: z.number().describe('First operand'),
  operandB: z.number().describe('Second operand'),
};

const calculatorParamSchema = z.object(calculatorParamShape);
type CalculatorParams = z.infer<typeof calculatorParamSchema>;

// Streaming Counter Tool - Demonstrates real-time notifications
const streamingCounterToolName = 'count-with-notifications';
const streamingCounterToolDescription = 'Counts from 1 to N and sends real-time notifications for each number';

const streamingCounterParamShape = {
  maxCount: z.number().min(1).max(10).describe('Maximum number to count to (1-10)')
};

const streamingCounterParamSchema = z.object(streamingCounterParamShape);
type StreamingCounterParams = z.infer<typeof streamingCounterParamSchema>;

// Register all MCP tools with the server
export function registerMCPTools(mcpServer: McpServer): void {
  // Register Calculator Tool
  mcpServer.tool(
    calculatorToolName,
    calculatorToolDescription,
    calculatorParamShape,
    async (params: CalculatorParams): Promise<CallToolResult> => {
      const { operation, operandA, operandB } = params;

      let calculationResult: number;
      let operationSymbol: string;

      switch (operation) {
        case 'add':
          calculationResult = operandA + operandB;
          operationSymbol = '+';
          break;
        case 'subtract':
          calculationResult = operandA - operandB;
          operationSymbol = '-';
          break;
        case 'multiply':
          calculationResult = operandA * operandB;
          operationSymbol = '×';
          break;
        case 'divide':
          if (operandB === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: Division by zero is not allowed.',
                },
              ],
              isError: true,
            };
          }
          calculationResult = operandA / operandB;
          operationSymbol = '÷';
          break;
        default:
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: Unknown operation '${operation}'.`,
              },
            ],
            isError: true,
          };
      }

      const resultText = `${operandA} ${operationSymbol} ${operandB} = ${calculationResult}`;

      return {
        content: [
          {
            type: 'text' as const,
            text: resultText,
          },
        ],
        result: calculationResult,
      };
    }
  );

  // Register Streaming Counter Tool
  mcpServer.tool(
    streamingCounterToolName,
    streamingCounterToolDescription,
    streamingCounterParamShape,
    async (params: StreamingCounterParams, { sendNotification }): Promise<CallToolResult> => {
      const { maxCount } = params;
      const startTime = Date.now();

      // Send real-time notifications for each count
      for (let currentCount = 1; currentCount <= maxCount; currentCount++) {
        await sendNotification({
          method: 'notifications/message',
          params: {
            level: 'info',
            data: `Counting: ${currentCount}`
          }
        });

        // Add delay to demonstrate real-time streaming
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const executionTime = Date.now() - startTime;
      const completionMessage = `✅ Finished counting to ${maxCount}`;

      return {
        content: [{
          type: 'text' as const,
          text: completionMessage
        }],
        result: {
          maxCount,
          executionTimeMs: executionTime,
          status: 'completed'
        },
      };
    }
  );

}

// Export tool configurations for external use
export const toolConfigurations = {
  calculator: {
    name: calculatorToolName,
    description: calculatorToolDescription,
    paramSchema: calculatorParamSchema,
  },
  streamingCounter: {
    name: streamingCounterToolName,
    description: streamingCounterToolDescription,
    paramSchema: streamingCounterParamSchema,
  },
};

// Export types for external use
export type { CalculatorParams, StreamingCounterParams };