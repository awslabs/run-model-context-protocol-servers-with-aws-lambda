export const SignatureV4 = jest.fn().mockImplementation(() => ({
  sign: jest.fn().mockImplementation(async (request: any) => ({
    ...request,
    headers: {
      ...request.headers,
      authorization: "AWS4-HMAC-SHA256 Credential=test/123",
      "x-amz-date": "20250416T000000Z"
    }
  }))
}));