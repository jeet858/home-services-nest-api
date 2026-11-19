import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import type { Request } from 'express';
import { AssignmentService } from '../assignment/assignment.service';
import { ProviderOnly } from '../common/guards/provider-only.decorator';
import { assertUuid } from '../common/utils/ids';
import { JobService } from '../job/job.service';
import { NotificationService } from '../notification/notification.service';
import { UploadFieldsInterceptor } from '../storage/upload-fields.interceptor';
import { PartnerService } from './partner.service';

const ok = (data: unknown) => ({ status: 'success', data });
const pid = (req: Request) => req.provider!.id;
const fileList = (files: any, field: string): Express.Multer.File[] => (files?.[field] as Express.Multer.File[]) ?? [];

// Partner (service professional) app API. Every route needs a provider token from /api/partner/auth.
@Controller('api/partner')
@ProviderOnly()
export class PartnerController {
  constructor(
    private readonly partner: PartnerService,
    private readonly jobs: JobService,
    private readonly assignments: AssignmentService,
    private readonly notifications: NotificationService,
  ) {}

  // ---- Profile ----

  @Get('me')
  async me(@Req() req: Request) {
    return ok(await this.partner.me(pid(req)));
  }

  @Patch('me/online')
  async online(@Req() req: Request, @Body() body: any) {
    return ok(await this.partner.setOnline(pid(req), body));
  }

  /** Location heartbeat while online, so matching uses where the professional is now. */
  @Patch('me/location')
  async location(@Req() req: Request, @Body() body: any) {
    return ok(await this.partner.setLocation(pid(req), body));
  }

  @Get('me/availability')
  async availability(@Req() req: Request) {
    return ok({ availability: (await this.partner.me(pid(req))).availability });
  }

  @Put('me/availability')
  async setAvailability(@Req() req: Request, @Body() body: any) {
    return ok(await this.partner.setAvailability(pid(req), body));
  }

  @Put('me/bank')
  async bank(@Req() req: Request, @Body() body: any) {
    return ok(await this.partner.setBank(pid(req), body));
  }

  @Post('me/documents')
  @UseInterceptors(UploadFieldsInterceptor([{ name: 'file', maxCount: 1 }]))
  async document(@Req() req: Request, @UploadedFiles() files: any) {
    return ok(await this.partner.uploadDocument(pid(req), req.body, fileList(files, 'file')[0]));
  }

  @Get('dashboard')
  async dashboard(@Req() req: Request) {
    return ok(await this.partner.dashboard(pid(req)));
  }

  // ---- Offers ----

  @Get('offers/current')
  async currentOffer(@Req() req: Request) {
    return ok({ offer: await this.partner.currentOffer(pid(req)) });
  }

  @Post('offers/:id/accept')
  async accept(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'offer');
    const booking = await this.assignments.accept(id, pid(req));
    return ok(await this.partner.job(pid(req), booking.id));
  }

  @Post('offers/:id/reject')
  async reject(@Req() req: Request, @Param('id') id: string, @Body() body: { reason?: string; note?: string }) {
    assertUuid(id, 'offer');
    const reason = [body?.reason, body?.note].filter((s) => typeof s === 'string' && s.trim()).join(': ');
    return ok(await this.assignments.reject(id, pid(req), reason || undefined));
  }

  // ---- Jobs ----

  @Get('jobs')
  async list(@Req() req: Request, @Query('tab') tab?: string, @Query('range') range?: string) {
    return ok(await this.partner.jobs(pid(req), tab ?? 'upcoming', range));
  }

  @Get('jobs/:id')
  async job(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'job');
    return ok(await this.partner.job(pid(req), id));
  }

  @Get('jobs/:id/catalogue')
  async catalogue(@Req() req: Request, @Param('id') id: string, @Query('q') q?: string) {
    assertUuid(id, 'job');
    return ok({ subservices: await this.partner.catalogue(pid(req), id, q) });
  }

  @Post('jobs/:id/start-trip')
  async startTrip(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'job');
    return ok(await this.jobs.startTrip(id, pid(req)));
  }

  @Post('jobs/:id/arrived')
  async arrived(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'job');
    return ok(await this.jobs.arrived(id, pid(req)));
  }

  @Post('jobs/:id/verify-otp')
  async verifyOtp(@Req() req: Request, @Param('id') id: string, @Body() body: { otp?: string }) {
    assertUuid(id, 'job');
    return ok(await this.jobs.verifyServiceOtp(id, pid(req), body?.otp));
  }

  @Post('jobs/:id/photos')
  @UseInterceptors(UploadFieldsInterceptor([{ name: 'photos', maxCount: 3 }]))
  async photos(@Req() req: Request, @Param('id') id: string, @Query('kind') kind: string, @UploadedFiles() files: any) {
    assertUuid(id, 'job');
    return ok(await this.jobs.addPhotos(id, pid(req), kind, fileList(files, 'photos')));
  }

  @Put('jobs/:id/quote')
  async quote(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    assertUuid(id, 'job');
    return ok(await this.jobs.sendQuote(id, pid(req), body));
  }

  @Post('jobs/:id/items/:itemId/respond')
  async respond(@Req() req: Request, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: any) {
    assertUuid(id, 'job');
    assertUuid(itemId, 'task');
    return ok(await this.jobs.providerRespond(id, pid(req), itemId, body));
  }

  @Post('jobs/:id/remind')
  async remind(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'job');
    return ok(await this.jobs.remindCustomer(id, pid(req)));
  }

  @Post('jobs/:id/confirm-cash')
  async confirmCash(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'job');
    return ok(await this.jobs.confirmCash(id, pid(req)));
  }

  @Post('jobs/:id/start-work')
  async startWork(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'job');
    return ok(await this.jobs.startWork(id, pid(req)));
  }

  @Patch('jobs/:id/items/:itemId/done')
  async done(@Req() req: Request, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: { done?: boolean }) {
    assertUuid(id, 'job');
    assertUuid(itemId, 'task');
    return ok(await this.jobs.setItemDone(id, pid(req), itemId, body?.done));
  }

  @Post('jobs/:id/complete')
  async complete(@Req() req: Request, @Param('id') id: string) {
    assertUuid(id, 'job');
    return ok(await this.jobs.complete(id, pid(req)));
  }

  @Post('jobs/:id/cancel')
  async cancel(@Req() req: Request, @Param('id') id: string, @Body() body: { reason?: string }) {
    assertUuid(id, 'job');
    return ok(await this.jobs.cancelByProvider(id, pid(req), body?.reason));
  }

  // ---- Earnings and inbox ----

  @Get('earnings')
  async earnings(@Req() req: Request, @Query('period') period?: string) {
    return ok(await this.partner.earnings(pid(req), period ?? 'week'));
  }

  @Get('notifications')
  async notificationsList(@Req() req: Request, @Query('page') page?: string) {
    return ok(await this.notifications.list({ type: 'provider', id: pid(req) }, parseInt(page ?? '') || 1));
  }

  @Post('notifications/read')
  async notificationsRead(@Req() req: Request, @Body() body: { ids?: string[] }) {
    return ok(await this.notifications.markRead({ type: 'provider', id: pid(req) }, body?.ids));
  }
}
