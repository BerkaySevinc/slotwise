export interface ErrorDetail {
  field: string;
  issue: string;
}

/** An error that maps to an HTTP response using the OpenAPI `Error` schema. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
