import { FIGHTER_ROSTER } from '../data/fighters';
import { generateProceduralIconDataUrl } from '../rendering/proceduralAssets';
import { FighterId } from '../types/game';
import { StitchClient, StitchConfig } from './stitchClient';

const IDB_NAME = 'StickmanTournamentStitchDB';
const IDB_STORE = 'generated_assets_v2';
const LS_FALLBACK_PREFIX = 'stickman_asset_cache_v2_';

interface CachedAssetRecord {
  key: string;
  dataUrl: string;
  source: 'stitch-api' | 'procedural';
  updatedAt: number;
}

export class AssetService {
  public readonly stitchClient: StitchClient;
  private iconUrls = new Map<FighterId, string>();
  private weaponImages = new Map<FighterId, HTMLImageElement>();
  private backdropImage: HTMLImageElement | null = null;
  private stitchAssetCount = 0;
  private lastError: string | null = null;

  constructor(config?: Partial<StitchConfig>) {
    this.stitchClient = new StitchClient(config);
    for (const def of FIGHTER_ROSTER) {
      this.iconUrls.set(def.id, generateProceduralIconDataUrl(def));
    }
  }

  public getIconUrl(id: FighterId): string {
    return this.iconUrls.get(id) || generateProceduralIconDataUrl(FIGHTER_ROSTER[0]);
  }

  public getWeaponSprite(id: FighterId): HTMLImageElement | null {
    return this.weaponImages.get(id) || null;
  }

  public getBackdropImage(): HTMLImageElement | null {
    return this.backdropImage;
  }

  public getStatusSummary(): {
    mode: 'stitch-api' | 'procedural-fallback';
    cachedStitchAssets: number;
    projectId?: string;
    lastError?: string | null;
  } {
    return {
      mode:
        this.stitchClient.isConfigured() && this.stitchAssetCount > 0
          ? 'stitch-api'
          : 'procedural-fallback',
      cachedStitchAssets: this.stitchAssetCount,
      projectId: this.stitchClient.getConfig().projectId,
      lastError: this.lastError,
    };
  }

  /**
   * 1) Hydrates cached Stitch assets from IndexedDB / LocalStorage.
   * 2) If Stitch API key is configured and assets aren't cached yet (or forceRegenerate = true),
   *    syncs from existing Stitch cloud project screens (`https://stitch.googleapis.com/mcp`) or
   *    generates a new 16-fighter SVG asset sheet in Google Stitch!
   */
  public async initializeAndSync(
    onProgress?: (msg: string) => void,
    options: { forceCloudSync?: boolean; forceGenerateNew?: boolean } = {}
  ): Promise<void> {
    this.lastError = null;

    if (!options.forceCloudSync && !options.forceGenerateNew) {
      const hydratedCount = await this.hydrateFromLocalCache();
      if (hydratedCount > 0) {
        this.stitchAssetCount = hydratedCount;
        onProgress?.(`Loaded ${hydratedCount} Stitch assets from IndexedDB cache.`);
        return;
      }
    }

    if (!this.stitchClient.isConfigured()) {
      return;
    }

    try {
      let pack = options.forceGenerateNew
        ? await this.stitchClient.generateRosterAssetPackInStitch(FIGHTER_ROSTER, onProgress)
        : await this.stitchClient.fetchExistingPackFromCloud(onProgress);

      const extractedCount =
        Object.keys(pack.icons).length +
        Object.keys(pack.weapons).length +
        (pack.backdrop ? 1 : 0);

      // If project exists in Stitch cloud but has no generated asset screens yet, generate it automatically!
      if (extractedCount === 0 && !options.forceGenerateNew) {
        pack = await this.stitchClient.generateRosterAssetPackInStitch(FIGHTER_ROSTER, onProgress);
      }

      let storedCount = 0;

      for (const def of FIGHTER_ROSTER) {
        const iconDataUrl = pack.icons[def.id];
        if (iconDataUrl) {
          this.iconUrls.set(def.id, iconDataUrl);
          storedCount++;
          await this.writeCache({
            key: `icon_${def.id}`,
            dataUrl: iconDataUrl,
            source: 'stitch-api',
            updatedAt: Date.now(),
          });
        }

        const weaponDataUrl = pack.weapons[def.id];
        if (weaponDataUrl) {
          const img = await this.loadImageSafe(weaponDataUrl);
          if (img) {
            this.weaponImages.set(def.id, img);
            storedCount++;
            await this.writeCache({
              key: `weapon_${def.id}`,
              dataUrl: weaponDataUrl,
              source: 'stitch-api',
              updatedAt: Date.now(),
            });
          }
        }
      }

      if (pack.backdrop) {
        const bgImg = await this.loadImageSafe(pack.backdrop);
        if (bgImg) {
          this.backdropImage = bgImg;
          storedCount++;
          await this.writeCache({
            key: 'arena_backdrop_main',
            dataUrl: pack.backdrop,
            source: 'stitch-api',
            updatedAt: Date.now(),
          });
        }
      }

      this.stitchAssetCount = storedCount;
      onProgress?.(
        storedCount > 0
          ? `Synced ${storedCount} vector assets from Google Stitch (Project ${pack.projectId})!`
          : 'Connected to Stitch; using procedural Canvas 2D vector fallback.'
      );
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Stitch sync failed';
      onProgress?.(`Stitch offline/fallback active (${this.lastError}).`);
    }
  }

  private async hydrateFromLocalCache(): Promise<number> {
    let count = 0;
    for (const def of FIGHTER_ROSTER) {
      const cachedIcon = await this.readCache(`icon_${def.id}`);
      if (cachedIcon?.source === 'stitch-api' && cachedIcon.dataUrl) {
        this.iconUrls.set(def.id, cachedIcon.dataUrl);
        count++;
      }

      const cachedWeapon = await this.readCache(`weapon_${def.id}`);
      if (cachedWeapon?.source === 'stitch-api' && cachedWeapon.dataUrl) {
        const img = await this.loadImageSafe(cachedWeapon.dataUrl);
        if (img) {
          this.weaponImages.set(def.id, img);
          count++;
        }
      }
    }

    const cachedBg = await this.readCache('arena_backdrop_main');
    if (cachedBg?.source === 'stitch-api' && cachedBg.dataUrl) {
      const bgImg = await this.loadImageSafe(cachedBg.dataUrl);
      if (bgImg) {
        this.backdropImage = bgImg;
        count++;
      }
    }

    return count;
  }

  public async clearStitchCache(): Promise<void> {
    this.weaponImages.clear();
    this.backdropImage = null;
    this.stitchAssetCount = 0;
    for (const def of FIGHTER_ROSTER) {
      this.iconUrls.set(def.id, generateProceduralIconDataUrl(def));
      try {
        localStorage.removeItem(`${LS_FALLBACK_PREFIX}icon_${def.id}`);
        localStorage.removeItem(`${LS_FALLBACK_PREFIX}weapon_${def.id}`);
      } catch {
        // ignore
      }
    }
    try {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(IDB_NAME);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
    } catch {
      // ignore
    }
  }

  private loadImageSafe(src: string): Promise<HTMLImageElement | null> {
    if (typeof Image === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async readCache(key: string): Promise<CachedAssetRecord | null> {
    const db = await this.openDb();
    if (db) {
      const rec = await new Promise<CachedAssetRecord | null>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readonly');
          const getReq = tx.objectStore(IDB_STORE).get(key);
          getReq.onsuccess = () => resolve((getReq.result as CachedAssetRecord) || null);
          getReq.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
      db.close();
      if (rec) return rec;
    }

    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(`${LS_FALLBACK_PREFIX}${key}`);
        return raw ? (JSON.parse(raw) as CachedAssetRecord) : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  private async writeCache(record: CachedAssetRecord): Promise<void> {
    const db = await this.openDb();
    if (db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      });
      db.close();
      return;
    }

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(`${LS_FALLBACK_PREFIX}${record.key}`, JSON.stringify(record));
      } catch {
        // ignore storage limit
      }
    }
  }
}
