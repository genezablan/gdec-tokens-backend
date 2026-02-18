import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RejectTokenRequestDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  comment: string;
}
