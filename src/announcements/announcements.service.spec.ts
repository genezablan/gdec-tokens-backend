import { AnnouncementsService } from './announcements.service';
import { Announcement } from '../entities/announcement.entity';
import { User } from '../entities/user.entity';

/**
 * Announcements are published as the organisation, not as the employee who
 * typed them. HR asked for this: a named byline invites the whole company to
 * route questions to one person's inbox.
 *
 * `toApi` touches none of the service's dependencies, so it can be exercised
 * without standing up repositories.
 */
describe('AnnouncementsService author privacy', () => {
  const service = new AnnouncementsService(
    ...(Array(9).fill(null) as unknown as ConstructorParameters<typeof AnnouncementsService>),
  );

  const toApi = (row: Announcement) => (service as any).toApi(row);

  const author = {
    id: 'user-1',
    firstName: 'Ma. Charmaine',
    lastName: 'Desaliza',
    get fullName() {
      return `${this.firstName} ${this.lastName}`;
    },
    profilePicture: 'profile-pictures/user-1/pic.jpg',
    position: 'Great Deals Academy Head',
  } as unknown as User;

  const row = {
    id: 'ann-1',
    authorId: 'user-1',
    author,
    title: 'Policy update',
    body: 'text',
    bodyHtml: '<p>text</p>',
    attachments: [],
    pinned: false,
    category: null,
    requiresAcknowledgement: false,
    createdAt: new Date('2026-09-02T03:15:00Z'),
    updatedAt: new Date('2026-09-02T03:15:00Z'),
  } as unknown as Announcement;

  it('never publishes the author, even when the row has one loaded', () => {
    expect(toApi(row).author).toBeNull();
  });

  it('leaks neither the name, the avatar nor the position', () => {
    const serialised = JSON.stringify(toApi(row));
    expect(serialised).not.toContain('Charmaine');
    expect(serialised).not.toContain('Desaliza');
    expect(serialised).not.toContain('profile-pictures');
    expect(serialised).not.toContain('Great Deals Academy Head');
  });

  it('still carries the announcement itself', () => {
    const api = toApi(row);
    expect(api.title).toBe('Policy update');
    expect(api.bodyHtml).toBe('<p>text</p>');
  });
});
