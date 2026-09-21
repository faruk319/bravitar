// Errors that map straight to an HTTP status. Services throw these; the route
// layer turns them into responses without inspecting messages.
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  constructor(what: string) {
    super(`${what} not found`, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in required") {
    super(message, 401);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string) {
    super(message, 429);
  }
}
