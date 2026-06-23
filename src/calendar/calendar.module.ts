import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CalendarConnection } from '../entities/calendar-connection.entity';
import { AuthModule } from '../auth/auth.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarCryptoService } from './calendar-crypto.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CalendarConnection]),
    AuthModule, // re-exports JwtModule (used to sign/verify OAuth state)
  ],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarCryptoService],
  exports: [CalendarService],
})
export class CalendarModule {}
