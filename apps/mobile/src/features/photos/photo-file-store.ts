import { Directory, File, Paths } from 'expo-file-system';
import type { PendingPhoto } from './photo-types';

function ownerDirectory(ownerUserId: string): Directory {
  return new Directory(Paths.document, 'trail-private-photos', ownerUserId);
}

function extension(mime: PendingPhoto['inputMime']): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'heic';
}

export async function persistPhotoFile(
  sourceUri: string,
  ownerUserId: string,
  photoId: string,
  mime: PendingPhoto['inputMime'],
): Promise<string> {
  const directory = ownerDirectory(ownerUserId);
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `${photoId}.${extension(mime)}`);
  await new File(sourceUri).copy(destination, { overwrite: true });
  return destination.uri;
}

export function removeManagedPhotoFile(uri: string): void {
  const file = new File(uri);
  if (file.exists) file.delete();
}

export function purgeManagedOwnerPhotos(ownerUserId: string): void {
  const directory = ownerDirectory(ownerUserId);
  if (directory.exists) directory.delete();
}
