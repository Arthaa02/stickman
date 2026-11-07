import { FIGHTER_ROSTER } from '../data/fighters';
import { FighterDefinition, FighterId } from '../types/game';

export const OFFICIAL_STITCH_MCP_URL = 'https://stitch.googleapis.com/mcp';
export const STITCH_ARENA_PROJECT_TITLE = 'Stickman Tournament Arena Assets';

export interface StitchConfig {
  baseUrl: string;
  apiKey: string;
  projectId?: string;
  assetScreenName?: string;
  timeoutMs: number;
}

export interface StitchAssetResponse {
  ok: boolean;
  dataUrl?: string;
  format?: 'svg' | 'png';
  source: 'stitch-api' | 'offline';
  errorMessage?: string;
}

export interface StitchExtractedPack {
  projectId: string;
  screenCount: number;
  icons: Partial<Record<FighterId, string>>;
  weapons: Partial<Record<FighterId, string>>;
  backdrop?: string;
}

interface StitchProjectSummary {
  name: string;
  title?: string;
  screenInstances?: Array<{ id?: string; sourceScreen?: string }>;
}

interface StitchScreenSummary {
  name: string;
  title?: string;
  htmlCode?: { name: string; downloadUrl?: string; mimeType?: string };
  screenshot?: { name: string; downloadUrl?: string; mimeType?: string };
}

interface GenerateScreenOutput {
  projectId?: string;
  screens?: StitchScreenSummary[];
  outputComponents?: Array<{
    design?: {
      screens?: StitchScreenSummary[];
    };
  }>;
}

interface DownloadFileOutput {
  html?: string;
  image?: string;
  imageMetadata?: { mimeType?: string; width?: number; height?: number };
}

const CONFIG_STORAGE_KEY = 'stickman_arena_stitch_config_v3';

export class StitchClient {
  private config: StitchConfig;
  private rpcCounter = 1;

  constructor(overrideConfig?: Partial<StitchConfig>) {
    const saved = this.loadSavedConfig();
    const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env || {};
    const envUrl = metaEnv.VITE_STITCH_API_URL || OFFICIAL_STITCH_MCP_URL;
    const envKey = metaEnv.VITE_STITCH_API_KEY || '';
    const envProj = metaEnv.VITE_STITCH_PROJECT_ID || undefined;
    const envScreen = metaEnv.VITE_STITCH_SCREEN_NAME || undefined;

    this.config = {
      baseUrl: overrideConfig?.baseUrl || saved?.baseUrl || envUrl || OFFICIAL_STITCH_MCP_URL,
      apiKey: overrideConfig?.apiKey ?? saved?.apiKey ?? envKey,
      projectId: overrideConfig?.projectId ?? saved?.projectId ?? envProj,
      assetScreenName: overrideConfig?.assetScreenName ?? saved?.assetScreenName ?? envScreen,
      timeoutMs: overrideConfig?.timeoutMs ?? 150000,
    };
  }

  private loadSavedConfig(): Partial<StitchConfig> | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Partial<StitchConfig>) : null;
    } catch {
      return null;
    }
  }

  public getConfig(): StitchConfig {
    return { ...this.config };
  }

  public updateConfig(next: Partial<StitchConfig>): void {
    this.config = {
      ...this.config,
      ...next,
      baseUrl: (next.baseUrl ?? this.config.baseUrl).trim() || OFFICIAL_STITCH_MCP_URL,
    };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(
          CONFIG_STORAGE_KEY,
          JSON.stringify({
            baseUrl: this.config.baseUrl,
            apiKey: this.config.apiKey,
            projectId: this.config.projectId,
            assetScreenName: this.config.assetScreenName,
          })
        );
      } catch {
        // Ignore storage quota errors
      }
    }
  }

  public isConfigured(): boolean {
    return Boolean(this.config.apiKey.trim());
  }

  /**
   * Resolves the effective transport URL.
   * Because https://stitch.googleapis.com/mcp omits browser CORS headers, browser requests
   * targeting the official Google Stitch endpoint automatically route via Vite's local
   * `/api/stitch/mcp` proxy while preserving the X-Goog-Api-Key authentication header.
   */
  private getEffectiveEndpointUrl(): string {
    const rawUrl = this.config.baseUrl.trim() || OFFICIAL_STITCH_MCP_URL;
    if (
      typeof window !== 'undefined' &&
      rawUrl.startsWith('https://stitch.googleapis.com/mcp')
    ) {
      return '/api/stitch/mcp';
    }
    return rawUrl;
  }

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    const key = this.config.apiKey.trim();
    if (key) {
      if (key.startsWith('ya29.')) {
        headers['Authorization'] = `Bearer ${key}`;
      } else {
        // Official Google Stitch API Key header (e.g. AQ.* keys)
        headers['X-Goog-Api-Key'] = key;
      }
    }
    return headers;
  }

  /**
   * Executes a JSON-RPC 2.0 `tools/call` against the Google Stitch MCP server.
   */
  public async callMcpTool<T = Record<string, unknown>>(
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs = this.config.timeoutMs
  ): Promise<T> {
    if (!this.isConfigured()) {
      throw new Error('Stitch API key is not configured.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(this.getEffectiveEndpointUrl(), {
        method: 'POST',
        headers: this.buildAuthHeaders(),
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          params: {
            name: toolName,
            arguments: args,
          },
          id: this.rpcCounter++,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Stitch MCP HTTP ${res.status}`);
      }

      const rawText = await res.text();
      const jsonLine = rawText.startsWith('data:')
        ? rawText
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .pop() || '{}'
        : rawText;

      const rpcPayload = JSON.parse(jsonLine) as {
        error?: { code: number; message: string };
        result?: {
          isError?: boolean;
          structuredContent?: T;
          content?: Array<{ type?: string; text?: string }>;
        };
      };

      if (rpcPayload.error) {
        throw new Error(rpcPayload.error.message || `MCP Error ${rpcPayload.error.code}`);
      }

      const result = rpcPayload.result;
      if (!result) {
        throw new Error('Empty MCP result from Stitch server');
      }

      if (result.structuredContent) {
        return result.structuredContent;
      }

      const firstText = result.content?.[0]?.text;
      if (firstText) {
        if (result.isError) {
          throw new Error(firstText);
        }
        return JSON.parse(firstText) as T;
      }

      return {} as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Finds or creates the dedicated "Stickman Tournament Arena Assets" container project in Stitch.
   */
  public async ensureArenaProject(): Promise<string> {
    if (this.config.projectId) {
      try {
        await this.callMcpTool('get_project', { name: `projects/${this.config.projectId}` }, 15000);
        return this.config.projectId;
      } catch {
        this.config.projectId = undefined;
      }
    }

    const listed = await this.callMcpTool<{ projects?: StitchProjectSummary[] }>(
      'list_projects',
      { filter: 'view=owned' },
      20000
    );

    const existing = listed.projects?.find((p) => p.title === STITCH_ARENA_PROJECT_TITLE);
    if (existing?.name) {
      const pid = existing.name.replace(/^projects\//, '');
      this.updateConfig({ projectId: pid });
      return pid;
    }

    const created = await this.callMcpTool<StitchProjectSummary>(
      'create_project',
      { title: STITCH_ARENA_PROJECT_TITLE },
      20000
    );

    const pid = (created.name || '').replace(/^projects\//, '');
    if (!pid) {
      throw new Error('Failed to obtain Stitch projectId from create_project');
    }
    this.updateConfig({ projectId: pid });
    return pid;
  }

  private extractScreensFromGenerateOutput(gen: GenerateScreenOutput): StitchScreenSummary[] {
    const out: StitchScreenSummary[] = [];
    if (Array.isArray(gen.screens)) {
      out.push(...gen.screens);
    }
    if (Array.isArray(gen.outputComponents)) {
      for (const comp of gen.outputComponents) {
        if (Array.isArray(comp.design?.screens)) {
          out.push(...comp.design.screens);
        }
      }
    }
    return out;
  }

  /**
   * Inspects known & listed screens inside the Stitch project, downloads their HTML/SVG and PNG files via
   * `download_file`, and extracts all 16 character icons, 2D weapon sprites, and backdrop!
   */
  public async fetchExistingPackFromCloud(
    onProgress?: (msg: string) => void
  ): Promise<StitchExtractedPack> {
    const projectId = await this.ensureArenaProject();
    onProgress?.(`Connected to Stitch project ${projectId}. Downloading vector assets...`);

    const candidateScreens: StitchScreenSummary[] = [];

    // 1. Check direct known asset screen resource name via `get_screen`
    if (this.config.assetScreenName) {
      try {
        const directScr = await this.callMcpTool<StitchScreenSummary>(
          'get_screen',
          { name: this.config.assetScreenName },
          20000
        );
        if (directScr?.name) {
          candidateScreens.push(directScr);
        }
      } catch {
        // Ignore if screen was deleted or belongs to a different project
      }
    }

    // 2. Also query `list_screens` & `get_project` screenInstances
    try {
      const listRes = await this.callMcpTool<{ screens?: StitchScreenSummary[] }>(
        'list_screens',
        { projectId },
        20000
      );
      for (const s of listRes.screens || []) {
        if (!candidateScreens.some((c) => c.name === s.name)) {
          candidateScreens.push(s);
        }
      }
    } catch {
      // ignore
    }

    if (candidateScreens.length === 0) {
      try {
        const proj = await this.callMcpTool<StitchProjectSummary>(
          'get_project',
          { name: `projects/${projectId}` },
          20000
        );
        for (const inst of proj.screenInstances || []) {
          if (inst.sourceScreen) {
            const s = await this.callMcpTool<StitchScreenSummary>(
              'get_screen',
              { name: inst.sourceScreen },
              15000
            );
            if (s?.name) candidateScreens.push(s);
          }
        }
      } catch {
        // ignore
      }
    }

    const pack: StitchExtractedPack = {
      projectId,
      screenCount: candidateScreens.length,
      icons: {},
      weapons: {},
    };

    for (const scr of candidateScreens) {
      if (scr.htmlCode?.name) {
        try {
          const dl = await this.callMcpTool<DownloadFileOutput>(
            'download_file',
            { name: scr.htmlCode.name },
            25000
          );
          if (dl.html) {
            this.extractSvgAssetsFromHtml(dl.html, pack);
          }
        } catch {
          // Continue inspecting other screens
        }
      }
    }

    return pack;
  }

  /**
   * Generates a complete 16-fighter vector icon + 2D weapon sprite catalog screen in Google Stitch
   * via `generate_screen_from_text`, then downloads and extracts every SVG sprite via `download_file`.
   */
  public async generateRosterAssetPackInStitch(
    fighters: FighterDefinition[] = FIGHTER_ROSTER,
    onProgress?: (msg: string) => void
  ): Promise<StitchExtractedPack> {
    const projectId = await this.ensureArenaProject();
    onProgress?.(`Generating 16-fighter SVG asset sheet in Google Stitch (Project ${projectId})...`);

    const iconLines = fighters
      .map(
        (f) =>
          `- <svg id="icon_${f.id}" viewBox="0 0 96 96">: ${f.stitchIconPrompt} (primary color ${f.color})`
      )
      .join('\n');

    const weaponLines = fighters
      .map(
        (f) =>
          `- <svg id="weapon_${f.id}" viewBox="0 0 160 80">: ${f.stitchWeaponPrompt} pointing horizontally right, transparent background`
      )
      .join('\n');

    const prompt = `Create a minimalist flat-vector "Stickman Tournament Arena Asset Sheet" page on a clean white background.
IMPORTANT: Every asset MUST be rendered as an inline <svg> element using clean geometric vector shapes (<path>, <circle>, <rect>, <polygon>, <ellipse>, <line>) with the EXACT id attribute listed below (do NOT use icon fonts or external <img> tags):

1) 16 Character Avatar Icons:
${iconLines}

2) 16 Transparent 2D Weapon Sprites:
${weaponLines}

3) 1 Minimalist White Box Arena Backdrop:
- <svg id="arena_backdrop" viewBox="0 0 960 540">: clean architectural tournament arena grid with subtle corner brackets on white.`;

    const gen = await this.callMcpTool<GenerateScreenOutput>(
      'generate_screen_from_text',
      {
        projectId,
        prompt,
        deviceType: 'DESKTOP',
        modelId: 'GEMINI_3_8_FLASH',
      },
      160000
    );

    const createdScreens = this.extractScreensFromGenerateOutput(gen);
    if (createdScreens[0]?.name) {
      this.updateConfig({ assetScreenName: createdScreens[0].name });
    }

    const pack: StitchExtractedPack = {
      projectId,
      screenCount: createdScreens.length,
      icons: {},
      weapons: {},
    };

    for (const scr of createdScreens) {
      if (scr.htmlCode?.name) {
        const dl = await this.callMcpTool<DownloadFileOutput>(
          'download_file',
          { name: scr.htmlCode.name },
          25000
        );
        if (dl.html) {
          this.extractSvgAssetsFromHtml(dl.html, pack);
        }
      }
    }

    if (Object.keys(pack.icons).length === 0 && Object.keys(pack.weapons).length === 0) {
      return this.fetchExistingPackFromCloud(onProgress);
    }

    return pack;
  }

  /**
   * Individual Character Icon endpoint wrapper using official Stitch MCP `generate_screen_from_text` + `download_file`.
   */
  public async requestCharacterIcon(
    fighterId: FighterId,
    prompt: string
  ): Promise<StitchAssetResponse> {
    return this.generateSingleSvgAsset(`icon_${fighterId}`, '96 96', prompt);
  }

  /**
   * Individual 2D Weapon Sprite endpoint wrapper using official Stitch MCP `generate_screen_from_text` + `download_file`.
   */
  public async requestWeaponSprite(
    fighterId: FighterId,
    prompt: string,
    _format: 'svg' | 'png' = 'svg'
  ): Promise<StitchAssetResponse> {
    return this.generateSingleSvgAsset(`weapon_${fighterId}`, '160 80', prompt);
  }

  /**
   * Arena Backdrop endpoint wrapper using official Stitch MCP `generate_screen_from_text` + `download_file`.
   */
  public async requestArenaBackdrop(prompt: string): Promise<StitchAssetResponse> {
    return this.generateSingleSvgAsset('arena_backdrop', '960 540', prompt);
  }

  private async generateSingleSvgAsset(
    targetSvgId: string,
    viewBox: string,
    prompt: string
  ): Promise<StitchAssetResponse> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        source: 'offline',
        errorMessage: 'Stitch API Key not configured; using procedural vector fallback.',
      };
    }

    try {
      const projectId = await this.ensureArenaProject();
      const fullPrompt = `Create a centered minimalist vector asset preview screen containing an inline <svg id="${targetSvgId}" viewBox="0 0 ${viewBox}"> illustrating: ${prompt}. Use pure SVG vector paths/shapes only.`;

      const gen = await this.callMcpTool<GenerateScreenOutput>(
        'generate_screen_from_text',
        {
          projectId,
          prompt: fullPrompt,
          deviceType: 'AGNOSTIC',
          modelId: 'GEMINI_3_5_FLASH_LITE',
        },
        120000
      );

      const screen = this.extractScreensFromGenerateOutput(gen)[0];
      if (screen?.htmlCode?.name) {
        const dl = await this.callMcpTool<DownloadFileOutput>(
          'download_file',
          { name: screen.htmlCode.name },
          20000
        );
        if (dl.html) {
          const svgDataUrl = this.findSvgByIdOrFirst(dl.html, targetSvgId);
          if (svgDataUrl) {
            return { ok: true, dataUrl: svgDataUrl, format: 'svg', source: 'stitch-api' };
          }
        }
      }

      if (screen?.screenshot?.name) {
        const dlImg = await this.callMcpTool<DownloadFileOutput>(
          'download_file',
          { name: screen.screenshot.name },
          20000
        );
        if (dlImg.image) {
          const mime = dlImg.imageMetadata?.mimeType || 'image/png';
          return {
            ok: true,
            dataUrl: `data:${mime};base64,${dlImg.image}`,
            format: 'png',
            source: 'stitch-api',
          };
        }
      }

      return { ok: false, source: 'offline', errorMessage: 'No SVG/PNG found in Stitch screen output' };
    } catch (err) {
      return {
        ok: false,
        source: 'offline',
        errorMessage: err instanceof Error ? err.message : 'Stitch MCP request failed',
      };
    }
  }

  /**
   * Parses Stitch-generated HTML to extract standalone SVG data-URIs for icons, weapons, and arena backdrop.
   */
  public extractSvgAssetsFromHtml(html: string, pack: StitchExtractedPack): void {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(html, 'text/html');

      for (const f of FIGHTER_ROSTER) {
        const slugHyphen = f.id.replace(/_/g, '-');
        const iconEl =
          doc.querySelector(`svg#icon_${f.id}`) ||
          doc.querySelector(`svg#icon-${slugHyphen}`) ||
          doc.querySelector(`[data-asset-id="icon_${f.id}"] svg`) ||
          doc.querySelector(`#icon_${f.id} svg`);

        if (iconEl && !pack.icons[f.id]) {
          pack.icons[f.id] = this.serializeSvgElementToDataUrl(iconEl);
        }

        const weaponEl =
          doc.querySelector(`svg#weapon_${f.id}`) ||
          doc.querySelector(`svg#weapon-${slugHyphen}`) ||
          doc.querySelector(`[data-asset-id="weapon_${f.id}"] svg`) ||
          doc.querySelector(`#weapon_${f.id} svg`);

        if (weaponEl && !pack.weapons[f.id]) {
          pack.weapons[f.id] = this.serializeSvgElementToDataUrl(weaponEl);
        }
      }

      const backdropEl =
        doc.querySelector('svg#arena_backdrop') ||
        doc.querySelector('svg#arena-backdrop') ||
        doc.querySelector('#arena_backdrop svg');
      if (backdropEl && !pack.backdrop) {
        pack.backdrop = this.serializeSvgElementToDataUrl(backdropEl);
      }

      return;
    }

    // Regex fallback for non-DOM environments
    const svgRegex = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
    const matches = html.match(svgRegex) || [];
    for (const rawSvg of matches) {
      for (const f of FIGHTER_ROSTER) {
        if (rawSvg.includes(`icon_${f.id}`) && !pack.icons[f.id]) {
          pack.icons[f.id] = this.encodeRawSvgDataUrl(rawSvg);
        } else if (rawSvg.includes(`weapon_${f.id}`) && !pack.weapons[f.id]) {
          pack.weapons[f.id] = this.encodeRawSvgDataUrl(rawSvg);
        }
      }
      if (rawSvg.includes('arena_backdrop') && !pack.backdrop) {
        pack.backdrop = this.encodeRawSvgDataUrl(rawSvg);
      }
    }
  }

  private findSvgByIdOrFirst(html: string, targetId: string): string | null {
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const el =
        doc.querySelector(`svg#${targetId}`) ||
        doc.querySelector(`#${targetId} svg`) ||
        doc.querySelector('svg');
      return el ? this.serializeSvgElementToDataUrl(el) : null;
    }
    const svgRegex = /<svg\b[^>]*>[\s\S]*?<\/svg>/gi;
    const all = html.match(svgRegex) || [];
    const exact = all.find((s) => s.includes(targetId)) || all[0];
    return exact ? this.encodeRawSvgDataUrl(exact) : null;
  }

  private serializeSvgElementToDataUrl(svgEl: Element): string {
    const clone = svgEl.cloneNode(true) as SVGElement;
    if (!clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!clone.getAttribute('viewBox')) {
      const w = clone.getAttribute('width') || '96';
      const h = clone.getAttribute('height') || '96';
      clone.setAttribute('viewBox', `0 0 ${parseFloat(w) || 96} ${parseFloat(h) || 96}`);
    }
    return this.encodeRawSvgDataUrl(clone.outerHTML);
  }

  private encodeRawSvgDataUrl(svgMarkup: string): string {
    let normalized = svgMarkup.trim();
    if (!/xmlns\s*=/.test(normalized)) {
      normalized = normalized.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return `data:image/svg+xml;utf8,${encodeURIComponent(normalized)}`;
  }
}
