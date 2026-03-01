import { strictEqual, throws } from 'node:assert';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import jszip from 'jszip';

import { decompressCrx } from '../src/decompress/decompressCrx';
import { ensureWithinDirectory } from '../src/fsUtils';

describe('ensureWithinDirectory', () => {
    it('should not throw for a valid path inside the base directory', () => {
        ensureWithinDirectory('/tmp/dest', '/tmp/dest/file.txt');
        ensureWithinDirectory('/tmp/dest', '/tmp/dest/sub/file.txt');
    });

    it('should not throw when target equals base directory', () => {
        ensureWithinDirectory('/tmp/dest', '/tmp/dest');
    });

    it('should throw for path traversal escaping the base directory', () => {
        throws(() => ensureWithinDirectory('/tmp/dest', '/tmp/evil.txt'), {
            message: /Malicious path detected in archive/,
        });
    });

    it('should throw for a parent directory traversal', () => {
        throws(() => ensureWithinDirectory('/tmp/dest', '/tmp'), {
            message: /Malicious path detected in archive/,
        });
    });

    it('should throw for a sibling directory', () => {
        throws(() => ensureWithinDirectory('/tmp/dest', '/tmp/other'), {
            message: /Malicious path detected in archive/,
        });
    });
});

describe('decompressCrx', () => {
    let testDir: string;

    before(() => {
        testDir = join(tmpdir(), `vscode-archive-decompresscrx-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
    });

    after(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });

    async function createZipBuffer(entries: Record<string, string>): Promise<Buffer> {
        const zip = new jszip();
        for (const [name, content] of Object.entries(entries)) {
            zip.file(name, content);
        }
        return zip.generateAsync({ type: 'nodebuffer' });
    }

    it('should extract a normal zip file correctly', async () => {
        const zipBuffer = await createZipBuffer({ 'hello.txt': 'world', 'sub/nested.txt': 'data' });
        const archivePath = join(testDir, 'normal.zip');
        const extractPath = join(testDir, 'normal-extract');

        await writeFile(archivePath, zipBuffer);
        mkdirSync(extractPath, { recursive: true });

        await decompressCrx(archivePath, extractPath);

        strictEqual(existsSync(join(extractPath, 'hello.txt')), true);
        const content = await readFile(join(extractPath, 'hello.txt'), 'utf8');
        strictEqual(content, 'world');
        strictEqual(existsSync(join(extractPath, 'sub', 'nested.txt')), true);
    });

    it('should reject when a zip entry resolves outside the destination', async () => {
        // Directly verify the guard by calling ensureWithinDirectory as decompressCrx does
        const extractPath = join(testDir, 'guard-test-extract');
        mkdirSync(extractPath, { recursive: true });

        const { join: pathJoin } = await import('node:path');

        // Simulate what decompressCrx does for a traversal filename
        const traversalFullPath = pathJoin(extractPath, '..', 'evil.txt');
        throws(() => ensureWithinDirectory(extractPath, traversalFullPath), {
            message: /Malicious path detected in archive/,
        });
    });
});
