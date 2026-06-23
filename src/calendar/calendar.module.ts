import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarConnection } from '../entities/calendar-connection.entity';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarCryptoService } from './calendar-crypto.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CalendarConnection]),
    // Own JwtModule (signs/verifies the OAuth `state`). Registered here rather
    // than importing AuthModule so AuthModule can depend on CalendarModule
    // (auto-connect at login) without a circular import.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key-change-in-production',
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarCryptoService],
  exports: [CalendarService],
})
export class CalendarModule {}
