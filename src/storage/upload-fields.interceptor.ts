import { CallHandler, ExecutionContext, Injectable, mixin, NestInterceptor, Type } from '@nestjs/common';
import multer from 'multer';
import { Observable } from 'rxjs';
import { ValidationError } from '../common/errors/app-errors';
import { upload } from './storage.client';

// Runs upload.fields(...) like the original route middleware, so req.files keeps the same shape.
export function UploadFieldsInterceptor(fields: multer.Field[]): Type<NestInterceptor> {
  @Injectable()
  class MixinInterceptor implements NestInterceptor {
    private readonly middleware = upload.fields(fields);

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
      const http = context.switchToHttp();
      await new Promise<void>((resolve, reject) =>
        this.middleware(http.getRequest(), http.getResponse(), (err: any) => {
          // fix: Multer limit errors used to fall through as 500s; report them as 400s.
          if (err instanceof multer.MulterError) return reject(new ValidationError(err.message));
          return err ? reject(err) : resolve();
        }),
      );
      return next.handle();
    }
  }
  return mixin(MixinInterceptor);
}
