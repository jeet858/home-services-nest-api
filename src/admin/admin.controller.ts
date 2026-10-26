import { Controller, Delete, Get, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminOnly } from '../common/guards/admin-only.decorator';
import { logger } from '../common/logger/logger';
import { assertUuid } from '../common/utils/ids';
import { AdminService } from './admin.service';

// login is public; everything after router.use(verifyToken, isAdmin) is @AdminOnly.
@Controller('api/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('login')
  async login(@Req() req: Request, @Res() res: Response) {
    const { email, password } = req.body;
    logger.info('Admin login attempt', { email });

    const result = await this.adminService.login(email, password);

    res.status(200).json({ status: 'success', data: { admin: result.admin, token: result.token } });
  }

  @Get('stats')
  @AdminOnly()
  async getStats(@Res() res: Response) {
    logger.info('Getting admin dashboard stats');

    const stats = await this.adminService.getStats();

    res.status(200).json({ status: 'success', data: stats });
  }

  @Post('admins')
  @AdminOnly()
  async createAdmin(@Req() req: Request, @Res() res: Response) {
    const adminData = req.body;
    // fix: was req.user._id, which the JWT never contains
    const createdBy = req.user.id;
    logger.info('Creating new admin', { createdBy });

    const admin = await this.adminService.createAdmin(adminData, createdBy);

    res.status(201).json({ status: 'success', data: { admin } });
  }

  @Get('admins')
  @AdminOnly()
  async getAllAdmins(@Req() req: Request, @Res() res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    logger.info('Getting all admins', { page, limit });

    const result = await this.adminService.getAllAdmins(page, limit);

    res.status(200).json({
      status: 'success',
      results: result.admins.length,
      pagination: result.pagination,
      data: { admins: result.admins },
    });
  }

  @Get('admins/:id')
  @AdminOnly()
  async getAdmin(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    logger.info('Getting admin by ID', { adminId: id });
    assertUuid(id, 'admin');

    const admin = await this.adminService.getAdmin(id);

    res.status(200).json({ status: 'success', data: { admin } });
  }

  @Put('admins/:id')
  @AdminOnly()
  async updateAdmin(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const updateData = req.body;
    logger.info('Updating admin', { adminId: id });
    assertUuid(id, 'admin');

    const admin = await this.adminService.updateAdmin(id, updateData);

    res.status(200).json({ status: 'success', data: { admin } });
  }

  @Delete('admins/:id')
  @AdminOnly()
  async deleteAdmin(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    // fix: was req.user._id (always undefined), so the self-deletion check never fired
    const currentAdminId = req.user.id;
    logger.info('Deleting admin', { adminId: id, currentAdminId });
    assertUuid(id, 'admin');

    await this.adminService.deleteAdmin(id, currentAdminId);

    res.status(200).json({ status: 'success', data: null });
  }

  @Get('users')
  @AdminOnly()
  async getAllUsers(@Req() req: Request, @Res() res: Response) {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    logger.info('Getting all users', { page, limit, search });

    const result = await this.adminService.getAllUsers(page, limit, search);

    res.status(200).json({
      status: 'success',
      results: result.users.length,
      pagination: result.pagination,
      data: { users: result.users },
    });
  }

  @Get('users/:id')
  @AdminOnly()
  async getUser(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    logger.info('Getting user by ID', { userId: id });
    assertUuid(id, 'user');

    const user = await this.adminService.getUser(id);

    res.status(200).json({ status: 'success', data: { user } });
  }

  @Put('users/:id')
  @AdminOnly()
  async updateUser(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    const updateData = req.body;
    logger.info('Updating user', { userId: id });
    assertUuid(id, 'user');

    const user = await this.adminService.updateUser(id, updateData);

    res.status(200).json({ status: 'success', data: { user } });
  }

  @Delete('users/:id')
  @AdminOnly()
  async deleteUser(@Req() req: Request, @Res() res: Response) {
    const { id } = req.params;
    logger.info('Deleting user', { userId: id });
    assertUuid(id, 'user');

    await this.adminService.deleteUser(id);

    res.status(200).json({ status: 'success', data: null });
  }
}
