import { describe, expect, it } from 'vitest';
import { matchesPrivateMetadata, type OrganizerPhoto } from './photo-organizer';

const photo: OrganizerPhoto = { displayName: 'IMG_0042', collections: [{ name: 'Friends' }], sidecars: [{ kind: 'xmp', metadata: { rating: 4, label: 'Blue', keywords: ['Jamie', 'Field trip'], title: 'Big smiles', description: null } }] };
describe('private Lightroom sorting aids', () => {
  it('combines keywords with existing names, collection labels and ratings without changing a photo', () => {
    const original = structuredClone(photo);
    expect(matchesPrivateMetadata(photo, ' Jamie ', '4')).toBe(true);
    expect(matchesPrivateMetadata(photo, 'friends', '3')).toBe(true);
    expect(matchesPrivateMetadata(photo, 'IMG_0042', 'all')).toBe(true);
    expect(matchesPrivateMetadata(photo, 'big smiles', '5')).toBe(false);
    expect(matchesPrivateMetadata(photo, 'another child', 'all')).toBe(false);
    expect(photo).toEqual(original);
  });
  it('handles unrated, absent metadata and rejected photos explicitly', () => {
    const unrated: OrganizerPhoto = { ...photo, sidecars: [] };
    expect(matchesPrivateMetadata(unrated, '', 'unrated')).toBe(true);
    expect(matchesPrivateMetadata(unrated, '', '3')).toBe(false);
    const rejected = structuredClone(photo); rejected.sidecars[0].metadata!.rating = -1;
    expect(matchesPrivateMetadata(rejected, '', 'all')).toBe(true);
    expect(matchesPrivateMetadata(rejected, '', 'rejected')).toBe(true);
    expect(matchesPrivateMetadata(rejected, '', 'unrated')).toBe(false);
    expect(matchesPrivateMetadata(photo, '', 'rejected')).toBe(false);
  });
  it('matches a tapped keyword exactly instead of including similar children names', () => {
    const ann = structuredClone(photo); ann.sidecars[0].metadata!.keywords = ['Ann'];
    const joanne = structuredClone(photo); joanne.sidecars[0].metadata!.keywords = ['Joanne'];
    expect(matchesPrivateMetadata(ann, '', 'all', 'Ann')).toBe(true);
    expect(matchesPrivateMetadata(joanne, '', 'all', 'Ann')).toBe(false);
    expect(matchesPrivateMetadata(joanne, 'ann', 'all')).toBe(true);
  });
});
