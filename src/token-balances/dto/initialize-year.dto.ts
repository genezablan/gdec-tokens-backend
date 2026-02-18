import { IsInt, IsNotEmpty, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class InitializeYearDto {
  @IsNotEmpty()
  @IsInt()
  @Min(2020)
  @Max(2100)
  @Type(() => Number)
  year: number;
}
