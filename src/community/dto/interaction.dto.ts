import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReactionType } from '../../common/enums';

/** POST /community/:id/react */
export class ReactDto {
  @IsEnum(ReactionType)
  type: ReactionType;
}

/** POST /community/:id/comments */
export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text: string;

  /** @mentioned user IDs (server hydrates names/avatars). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mentions?: string[];
}

/** POST /community/:id/vote */
export class VoteDto {
  @IsString()
  @IsNotEmpty()
  optionId: string;
}
