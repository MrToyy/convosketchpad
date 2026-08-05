export class CanvasApplicationError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409 | 410 | 422 | 502 | 503;
  readonly publicMessage: string;

  constructor(
    code: string,
    status: CanvasApplicationError['status'],
    publicMessage = code,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = 'CanvasApplicationError';
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
  }
}
