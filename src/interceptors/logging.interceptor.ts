import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { tap } from 'rxjs';

@Injectable()
export class LoggingService implements NestInterceptor {
  private readonly logger = new Logger(LoggingService.name);

  intercept(context: ExecutionContext, next: CallHandler<any>) {
    const now = Date.now();
    const request = context.switchToHttp().getRequest<Request>();
    const { method, path, ip } = request;
    const userAgent = request.get('user-agent') || '';

    return next.handle().pipe(
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse<Response>();
          const { statusCode } = response;
          const after = Date.now();
          const timeDiff = after - now;

          this.logger.log(
            `${method} ${path} ${statusCode} ${timeDiff}ms - ${ip} - ${userAgent.substring(0, 50)}`,
          );
        },
        error: (err: any) => {
          const after = Date.now();
          const timeDiff = after - now;
          this.logger.log(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            `${method} ${path} ${err.status} ${timeDiff}ms - ${ip} - ${userAgent.substring(0, 50)}`,
          );
        },
      }),
    );
  }
}
