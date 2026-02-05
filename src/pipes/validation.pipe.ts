/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

// Inspiration: https://docs.nestjs.com/pipes#class-validator
@Injectable()
export class ValidationPipe implements PipeTransform {
  async transform(value: any, metadata: ArgumentMetadata) {
    if (!metadata.metatype || !this.toValidate(metadata.metatype)) return value;

    const validatedObject = plainToInstance(metadata.metatype, value);
    const errors = await validate(validatedObject);

    if (errors.length) {
      const errorMessages = errors.map((error) => ({
        property: error.property,
        constraintValues: Object.values(error.constraints || {}),
      }));
      throw new BadRequestException(JSON.stringify(errorMessages));
    }
    return value;
  }

  private toValidate(metatype: Function): boolean {
    const types: Function[] = [String, Boolean, Number, Array, Object];
    return !types.includes(metatype);
  }
}
