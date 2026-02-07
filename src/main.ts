import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { randomUUID } from 'crypto';

function setupSwagger(app: INestApplication<any>) {
  const config = new DocumentBuilder()
    .setTitle('Magnetar Finance - DEX service API')
    .setVersion('1.0')
    .setDescription('Magnetar Finance DEX API documentation')
    .addTag('dex')
    .build();
  const documentFactory = () =>
    SwaggerModule.createDocument(app, config, {
      operationIdFactory: (controllerKey, methodKey) =>
        `${controllerKey}_${methodKey}_${randomUUID()}`,
      autoTagControllers: false,
      ignoreGlobalPrefix: false,
    });
  return SwaggerModule.setup('docs', app, documentFactory, { useGlobalPrefix: false, ui: true });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 13000);

  app.enableShutdownHooks();
  app.setGlobalPrefix('/api');

  setupSwagger(app);

  await app.listen(port);
}
void bootstrap();
