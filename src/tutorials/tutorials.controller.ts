import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  ParseUUIDPipe,
  BadRequestException,
} from '@nestjs/common';
import { TutorialsService } from './tutorials.service';
import { CreateTutorialDto } from './dto/create-tutorial.dto';
import { UpdateTutorialDto } from './dto/update-tutorial.dto';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../common/enums';

/**
 * Parses the optional `fileSize` query param (bytes). Returns undefined when
 * absent or unparseable so the service falls back to skipping the size check.
 */
const parseFileSize = (raw?: string): number | undefined => {
  if (raw === undefined || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

@Controller('tutorials')
export class TutorialsController {
  constructor(private readonly tutorialsService: TutorialsService) {}

  /**
   * GET /api/tutorials
   * Public: returns active tutorials (with a video) for the Video Guide, ordered by displayOrder.
   * Pass ?all=true to include inactive tutorials and drafts without a video (admin/debug).
   */
  @Public()
  @Get()
  findAll(@Query('all') all: string) {
    const showAll = all === 'true';
    return this.tutorialsService.findAll(!showAll);
  }

  /**
   * POST /api/tutorials
   * Admin only: create a tutorial record (video/thumbnail uploaded separately).
   */
  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateTutorialDto) {
    return this.tutorialsService.create(dto);
  }

  /**
   * GET /api/tutorials/:id
   * Public: returns a single tutorial with pre-signed video/thumbnail URLs.
   */
  @Public()
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tutorialsService.findOne(id);
  }

  /**
   * PATCH /api/tutorials/:id
   * Admin only: update title, category, description, durationSeconds, displayOrder, isActive.
   */
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTutorialDto,
  ) {
    return this.tutorialsService.update(id, dto);
  }

  /**
   * DELETE /api/tutorials/:id
   * Admin only: delete a tutorial.
   */
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.tutorialsService.remove(id);
  }

  /**
   * GET /api/tutorials/:id/video/presigned-upload?fileName=&contentType=&fileSize=
   * Admin only: get a pre-signed S3 PUT URL so the browser can upload the video directly.
   * `fileSize` (bytes) is optional; when sent it is checked against the 1 GB limit.
   */
  @Get(':id/video/presigned-upload')
  @Roles(UserRole.ADMIN)
  getVideoPresignedUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('fileName') fileName: string,
    @Query('contentType') contentType: string,
    @Query('fileSize') fileSize?: string,
  ) {
    if (!fileName || !contentType) {
      throw new BadRequestException(
        'fileName and contentType query params are required',
      );
    }
    return this.tutorialsService.getAssetPresignedUpload(
      id,
      'video',
      fileName,
      contentType,
      parseFileSize(fileSize),
    );
  }

  /**
   * PATCH /api/tutorials/:id/video
   * Admin only: save the video S3 key after the browser uploaded directly to S3.
   * Body: { key }
   */
  @Patch(':id/video')
  @Roles(UserRole.ADMIN)
  saveVideo(@Param('id', ParseUUIDPipe) id: string, @Body('key') key: string) {
    if (!key) {
      throw new BadRequestException('key is required');
    }
    return this.tutorialsService.saveVideo(id, key);
  }

  /**
   * GET /api/tutorials/:id/thumbnail/presigned-upload?fileName=&contentType=&fileSize=
   * Admin only: get a pre-signed S3 PUT URL so the browser can upload the thumbnail directly.
   * `fileSize` (bytes) is optional; when sent it is checked against the 5 MB limit.
   */
  @Get(':id/thumbnail/presigned-upload')
  @Roles(UserRole.ADMIN)
  getThumbnailPresignedUpload(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('fileName') fileName: string,
    @Query('contentType') contentType: string,
    @Query('fileSize') fileSize?: string,
  ) {
    if (!fileName || !contentType) {
      throw new BadRequestException(
        'fileName and contentType query params are required',
      );
    }
    return this.tutorialsService.getAssetPresignedUpload(
      id,
      'thumbnail',
      fileName,
      contentType,
      parseFileSize(fileSize),
    );
  }

  /**
   * PATCH /api/tutorials/:id/thumbnail
   * Admin only: save the thumbnail S3 key after the browser uploaded directly to S3.
   * Body: { key }
   */
  @Patch(':id/thumbnail')
  @Roles(UserRole.ADMIN)
  saveThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('key') key: string,
  ) {
    if (!key) {
      throw new BadRequestException('key is required');
    }
    return this.tutorialsService.saveThumbnail(id, key);
  }
}
