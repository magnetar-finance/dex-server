import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Response } from 'express';
import { map } from 'rxjs/operators';

@Injectable()
export class TransformService implements NestInterceptor {
  constructor() {}

  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse<Response>();
        return {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          data,
          status: response.statusCode,
        };
      }),
    );
  }
}
