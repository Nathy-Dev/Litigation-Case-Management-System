import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

export function useDocumentFiles() {
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const finalizeUpload = useMutation(api.documents.finalizeUpload);
  const addVersion = useMutation(api.documents.addDocumentVersion);

  const storeFile = async (file: File): Promise<Id<'_storage'>> => {
    if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('Choose a file between 1 byte and 50 MB.');
    const url = await generateUploadUrl({});
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
    if (!response.ok) throw new Error('The file could not be uploaded. Please retry.');
    const result = await response.json() as { storageId?: Id<'_storage'> };
    if (!result.storageId) throw new Error('The upload did not return a storage reference.');
    return result.storageId;
  };

  return {
    upload: async (file: File, input: Omit<Parameters<typeof finalizeUpload>[0]['input'], 'storageId' | 'storageKey' | 'sizeBytes'>) => {
      const storageId = await storeFile(file);
      return finalizeUpload({ input: { ...input, storageId, storageKey: storageId, sizeBytes: file.size } });
    },
    replace: async (id: string, file: File, changeNote: string) => {
      const storageId = await storeFile(file);
      return addVersion({ id: id as Id<'documents'>, storageId, storageKey: storageId, sizeBytes: file.size, changeNote });
    },
  };
}
