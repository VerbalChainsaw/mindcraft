import { randomBytes } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export function writeFileAtomicSync(filePath, contents, encoding = 'utf8') {
  const target = path.resolve(filePath);
  mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  let descriptor;
  try {
    descriptor = openSync(temporary, 'wx');
    writeFileSync(descriptor, contents, { encoding });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* already closed */ }
    }
    try { unlinkSync(temporary); } catch { /* nothing staged */ }
    throw error;
  }
}

export function writeJsonAtomicSync(filePath, value, spaces = 2) {
  writeFileAtomicSync(filePath, `${JSON.stringify(value, null, spaces)}\n`, 'utf8');
}
