import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { MAX_PHOTO_INPUT_BYTES, type ActivityPhoto } from '@trail/contracts';
import { Body, Button, StatusBanner } from '../../components/ui';
import { useAppState } from '../../state/app-state';
import { recordingRepository } from '../../storage/recording-database';
import { spacing, useTheme } from '../../theme/tokens';
import { persistPhotoFile, removeManagedPhotoFile } from './photo-file-store';
import {
  deleteFailureMessage,
  galleryStatus,
  remainingPhotoSlots,
} from './photo-gallery-model';
import { notifyPhotoQueued, usePhotoSync } from './photo-sync-runtime';
import type { PendingPhoto } from './photo-types';

function supportedMime(
  value: string | null | undefined,
): PendingPhoto['inputMime'] | null {
  if (value === 'image/jpeg' || value === 'image/webp') return value;
  if (value === 'image/heic' || value === 'image/heif') return 'image/heic';
  return null;
}

export function PhotoGallery({ activityId }: { activityId: string }) {
  const { api, profile } = useAppState();
  const sync = usePhotoSync();
  const theme = useTheme();
  const [remote, setRemote] = useState<ActivityPhoto[]>([]);
  const [local, setLocal] = useState<PendingPhoto[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const [serverPhotos, localPhotos] = await Promise.all([
        api.listPhotos(activityId),
        recordingRepository.listPendingPhotos(profile.id, activityId),
      ]);
      setRemote(serverPhotos);
      setLocal(localPhotos);
      const readyIds = new Set(
        serverPhotos
          .filter((photo) => photo.status === 'ready')
          .map((photo) => photo.id),
      );
      await Promise.all(
        localPhotos
          .filter(
            (photo) => photo.serverPhotoId && readyIds.has(photo.serverPhotoId),
          )
          .map(async (photo) => {
            removeManagedPhotoFile(photo.localUri);
            await recordingRepository.removePendingPhoto(profile.id, photo.id);
          }),
      );
    } catch {
      setMessage(
        'Photos could not be refreshed. Pending uploads remain saved.',
      );
    }
  }, [activityId, api, profile]);
  useEffect(() => {
    void load();
  }, [load, sync.revision]);

  const remoteById = useMemo(
    () => new Map(remote.map((photo) => [photo.id, photo])),
    [remote],
  );
  const localServerIds = new Set(
    local.flatMap((photo) =>
      photo.serverPhotoId ? [photo.serverPhotoId] : [],
    ),
  );
  const localWithoutReady = local.filter(
    (photo) =>
      !photo.serverPhotoId ||
      remoteById.get(photo.serverPhotoId)?.status !== 'ready',
  );
  const remaining = remainingPhotoSlots(
    remote.map((photo) => photo.id),
    localWithoutReady,
  );

  const choosePhotos = async () => {
    if (!profile || remaining === 0) return;
    setMessage(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMessage('Photo library access is needed only when you choose photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      exif: false,
      quality: 1,
    });
    if (result.canceled) return;
    let accepted = 0;
    let rejected = 0;
    for (const asset of result.assets.slice(0, remaining)) {
      const mime = supportedMime(asset.mimeType);
      if (
        !mime ||
        !asset.fileSize ||
        asset.fileSize <= 0 ||
        asset.fileSize > MAX_PHOTO_INPUT_BYTES
      ) {
        rejected += 1;
        continue;
      }
      const photoId = Crypto.randomUUID();
      const managedUri = await persistPhotoFile(
        asset.uri,
        profile.id,
        photoId,
        mime,
      );
      try {
        await recordingRepository.addPendingPhoto({
          id: photoId,
          ownerUserId: profile.id,
          activityId,
          localUri: managedUri,
          inputMime: mime,
          inputSizeBytes: asset.fileSize,
          nowMs: Date.now(),
        });
        accepted += 1;
      } catch (cause) {
        removeManagedPhotoFile(managedUri);
        throw cause;
      }
    }
    if (rejected)
      setMessage(
        `${rejected} photo${rejected === 1 ? '' : 's'} skipped. Use JPEG, HEIC, or WebP up to 10 MiB each.`,
      );
    if (accepted) notifyPhotoQueued();
    await load();
  };

  const remove = async (
    serverPhotoId: string | null,
    localPhotoId?: string,
  ) => {
    if (!profile) return;
    setMessage(null);
    try {
      if (serverPhotoId) await api.deletePhoto(activityId, serverPhotoId);
      if (localPhotoId) {
        const pending = local.find((photo) => photo.id === localPhotoId);
        if (pending) removeManagedPhotoFile(pending.localUri);
        await recordingRepository.removePendingPhoto(profile.id, localPhotoId);
      }
      if (serverPhotoId)
        await recordingRepository.removePendingPhotoByServerId(
          profile.id,
          serverPhotoId,
        );
      await load();
    } catch {
      setMessage(deleteFailureMessage());
    }
  };

  return (
    <View style={styles.container}>
      {message ? <StatusBanner message={message} /> : null}
      {remote
        .filter((photo) => photo.status === 'ready')
        .map((photo) => (
          <View key={photo.id} style={styles.photoRow}>
            {photo.download_url ? (
              <Image
                accessibilityLabel="Private activity photo"
                source={{ uri: photo.download_url }}
                style={styles.image}
              />
            ) : null}
            <Body>
              {photo.width} × {photo.height} · Ready
            </Body>
            <Button
              accessibilityHint="Permanently deletes this private photo after confirmation."
              label="Delete photo"
              variant="danger"
              onPress={() =>
                Alert.alert('Delete this photo?', 'This cannot be undone.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => void remove(photo.id),
                  },
                ])
              }
            />
          </View>
        ))}
      {remote
        .filter(
          (photo) => photo.status !== 'ready' && !localServerIds.has(photo.id),
        )
        .map((photo) => (
          <View
            key={photo.id}
            style={[styles.pending, { borderColor: theme.border }]}
          >
            <Text
              accessibilityLiveRegion="polite"
              style={{
                color:
                  photo.status === 'failed' ? theme.warning : theme.textPrimary,
              }}
            >
              {photo.status === 'failed'
                ? 'Photo processing failed'
                : 'Processing privately'}
            </Text>
            <Button
              accessibilityHint="Permanently deletes this private photo after confirmation."
              label="Delete photo"
              variant="danger"
              onPress={() =>
                Alert.alert(
                  'Delete this photo?',
                  'The private upload will be deleted.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => void remove(photo.id),
                    },
                  ],
                )
              }
            />
          </View>
        ))}
      {localWithoutReady.map((photo) => {
        const server = photo.serverPhotoId
          ? remoteById.get(photo.serverPhotoId)
          : undefined;
        const { failed, label } = galleryStatus(photo.status, server?.status);
        return (
          <View
            key={photo.id}
            style={[styles.pending, { borderColor: theme.border }]}
          >
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: failed ? theme.warning : theme.textPrimary }}
            >
              {label} · {photo.progress}%
            </Text>
            {failed ? (
              <Button
                busy={sync.syncing}
                label="Retry photo"
                onPress={() => void sync.retry(photo.id)}
              />
            ) : null}
            <Button
              accessibilityHint="Deletes the private upload after confirmation."
              label="Remove photo"
              variant="danger"
              onPress={() =>
                Alert.alert(
                  'Remove this photo?',
                  'The private upload will be deleted.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Remove',
                      style: 'destructive',
                      onPress: () => void remove(photo.serverPhotoId, photo.id),
                    },
                  ],
                )
              }
            />
          </View>
        );
      })}
      <Button
        disabled={remaining === 0}
        label={
          remaining
            ? `Add photos (${remaining} remaining)`
            : 'Photo limit reached'
        }
        onPress={() => void choosePhotos()}
      />
      <Body>
        Photos upload independently. Closing this screen does not block your
        activity. Capture time or location is never read from photo metadata.
      </Body>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.space3 },
  image: { borderRadius: 8, height: 180, width: '100%' },
  pending: {
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.space2,
    padding: spacing.space3,
  },
  photoRow: { gap: spacing.space2 },
});
