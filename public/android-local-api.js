(() => {
  const STORAGE_KEY = "linkotecaAndroidDatabase";
  const APP_VERSION = "1.0.3";
  const inactiveStatuses = new Set(["trash", "deleted", "eliminado", "papelera"]);

  const id = (prefix) => `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const now = () => new Date().toISOString();
  const normalizedUrl = (value) => {
    try {
      const parsed = new URL(String(value || "").trim());
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "").toLowerCase();
    } catch {
      return String(value || "").trim().toLowerCase();
    }
  };
  const hostFromUrl = (value) => {
    try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return "web"; }
  };

  function createDefaultDatabase() {
    const timestamp = now();
    return {
      version: 2,
      createdAt: timestamp,
      updatedAt: timestamp,
      categories: [],
      groups: [],
      links: [],
      settings: {
        contact: { ownerName: "Ernesto Pernett", ownerTitle: "Ingeniero Mecánico", githubProfileUrl: "https://github.com/colombianitov2" },
        storage: { path: "dispositivo Android", format: "json" },
        updates: { latestVersionUrl: "" }
      }
    };
  }

  function migrateDatabase(database) {
    const fakeTodosIds = new Set(
      database.categories
        .filter((item) => item.archived !== true && String(item.name || "").trim().toLowerCase() === "todos" && (!item.groupId || item.source === "android" || item.source === "restore"))
        .map((item) => item.id)
    );
    if (!fakeTodosIds.size) return false;
    for (const link of database.links) {
      if (fakeTodosIds.has(link.categoryId)) link.categoryId = null;
    }
    database.categories = database.categories.filter((item) => !fakeTodosIds.has(item.id));
    return true;
  }

  function readDatabase() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (parsed && Array.isArray(parsed.links) && Array.isArray(parsed.categories) && Array.isArray(parsed.groups)) {
        parsed.settings ||= createDefaultDatabase().settings;
        if (migrateDatabase(parsed)) writeDatabase(parsed);
        return parsed;
      }
    } catch { /* corrupted local data is replaced with a clean local library */ }
    const fresh = createDefaultDatabase();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function writeDatabase(database) {
    database.updatedAt = now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  }

  function bodyOf(options) {
    if (!options.body) return {};
    if (typeof options.body === "string") {
      try { return JSON.parse(options.body); } catch { return {}; }
    }
    return options.body;
  }

  function findCategory(database, categoryId) {
    return database.categories.find((category) => category.id === categoryId);
  }

  function findGroup(database, groupId) {
    return database.groups.find((group) => group.id === groupId);
  }

  function activeLink(link) {
    return link && link.archived !== true && !inactiveStatuses.has(String(link.status || "").toLowerCase());
  }

  function exportDatabase(database) {
    return {
      format: "linkoteca-local-export",
      exportedAt: now(),
      version: database.version,
      groups: database.groups.map(({ id, name, slug, archived, archivedAt, createdAt, updatedAt }) => ({ id, name, slug, archived, archivedAt, createdAt, updatedAt })),
      categories: database.categories.map(({ id, name, slug, parentId, groupId, archived, archivedAt, createdAt, updatedAt }) => ({ id, name, slug, parentId, groupId, archived, archivedAt, createdAt, updatedAt })),
      links: database.links.map(({ id, url, title, description, thumbnail, platform, tags, categoryId, status, createdAt, updatedAt, archived, archivedAt }) => ({ id, url, title, description, thumbnail, platform, tags, categoryId, status, createdAt, updatedAt, archived, archivedAt }))
    };
  }

  function csvExport(database) {
    const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [["title", "url", "description", "category", "archived"]];
    for (const link of database.links) rows.push([link.title, link.url, link.description, findCategory(database, link.categoryId)?.name || "", link.archived ? "true" : "false"]);
    return rows.map((row) => row.map(quote).join(",")).join("\n");
  }

  function csvImport(content) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const text = String(content || "").replace(/\r\n/g, "\n");
    for (let index = 0; index <= text.length; index += 1) {
      const character = text[index] || "\n";
      if (character === '"') {
        if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = !quoted;
      } else if (character === "," && !quoted) {
        row.push(field); field = "";
      } else if (character === "\n" && !quoted) {
        row.push(field); field = "";
        if (row.some((value) => value.trim())) rows.push(row);
        row = [];
      } else {
        field += character;
      }
    }
    const headers = (rows.shift() || []).map((value) => value.trim().toLowerCase());
    return {
      links: rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])))
    };
  }

  function textImport(content) {
    const urls = String(content || "").match(/https?:\/\/[^\s]+/gi) || [];
    return { links: urls.map((url) => ({ url, title: url })) };
  }

  function mergeImport(database, imported) {
    const groupIds = new Map();
    const categoryIds = new Map();
    for (const source of (Array.isArray(imported.groups) ? imported.groups : [])) {
      const sourceId = String(source.id || "");
      let target = database.groups.find((group) => sourceId && group.id === sourceId)
        || database.groups.find((group) => String(group.name || "").trim().toLowerCase() === String(source.name || "").trim().toLowerCase());
      if (!target) {
        target = {
          id: sourceId && !database.groups.some((group) => group.id === sourceId) ? sourceId : id("group"),
          name: String(source.name || "Grupo importado").trim(),
          slug: String(source.slug || ""),
          archived: Boolean(source.archived),
          archivedAt: String(source.archivedAt || ""),
          createdAt: source.createdAt || now(),
          updatedAt: source.updatedAt || now()
        };
        database.groups.push(target);
      }
      if (sourceId) groupIds.set(sourceId, target.id);
    }

    for (const source of (Array.isArray(imported.categories) ? imported.categories : [])) {
      const sourceId = String(source.id || "");
      const mappedGroupId = groupIds.get(String(source.groupId || "")) || null;
      let target = database.categories.find((category) => sourceId && category.id === sourceId)
        || database.categories.find((category) => String(category.name || "").trim().toLowerCase() === String(source.name || "").trim().toLowerCase() && (category.groupId || null) === mappedGroupId);
      if (!target) {
        target = {
          id: sourceId && !database.categories.some((category) => category.id === sourceId) ? sourceId : id("category"),
          name: String(source.name || "Carpeta importada").trim(),
          slug: String(source.slug || ""),
          parentId: null,
          groupId: mappedGroupId,
          archived: Boolean(source.archived),
          archivedAt: String(source.archivedAt || ""),
          createdAt: source.createdAt || now(),
          updatedAt: source.updatedAt || now()
        };
        database.categories.push(target);
      }
      if (sourceId) categoryIds.set(sourceId, target.id);
    }

    const existing = new Set(database.links.map((link) => normalizedUrl(link.url)));
    let count = 0;
    for (const source of (Array.isArray(imported.links) ? imported.links : [])) {
      const url = String(source.url || "").trim();
      if (!/^https?:\/\//i.test(url) || existing.has(normalizedUrl(url))) continue;
      const timestamp = now();
      const archived = source.archived === true || String(source.archived || "").toLowerCase() === "true";
      database.links.push({
        id: source.id && !database.links.some((link) => link.id === source.id) ? String(source.id) : id("link"),
        url,
        title: String(source.title || url),
        description: String(source.description || ""),
        thumbnail: String(source.thumbnail || ""),
        platform: String(source.platform || hostFromUrl(url)),
        tags: Array.isArray(source.tags) ? source.tags : [],
        categoryId: categoryIds.get(String(source.categoryId || "")) || null,
        status: archived ? "archivado" : "confirmado",
        createdAt: source.createdAt || timestamp,
        updatedAt: source.updatedAt || timestamp,
        archived,
        archivedAt: archived ? String(source.archivedAt || timestamp) : ""
      });
      existing.add(normalizedUrl(url));
      count += 1;
    }
    return count;
  }

  async function androidApi(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const parsed = new URL(path, "https://linkoteca.android.local");
    const pathname = parsed.pathname;
    const database = readDatabase();
    const payload = bodyOf(options);

    if (pathname === "/api/session") return { ok: true, token: "android-local-session" };
    if (pathname === "/api/version") return { ok: true, app: "Linkoteca Android", version: APP_VERSION, latest: APP_VERSION, status: "local", notes: "", downloadUrl: "", canAutoUpdate: false };
    if (pathname === "/api/library") return { version: database.version, groups: database.groups, categories: database.categories, links: database.links, settings: database.settings };
    if (pathname === "/api/preview" && method === "POST") {
      const url = String(payload.url || "").trim();
      return { ok: true, preview: { title: hostFromUrl(url), description: "", thumbnail: "", platform: hostFromUrl(url) } };
    }

    const linkMatch = pathname.match(/^\/api\/links\/([^/]+)$/);
    const linkRestoreMatch = pathname.match(/^\/api\/links\/([^/]+)\/restore$/);
    const links = database.links;
    if (pathname === "/api/links" && method === "POST") {
      const url = String(payload.url || "").trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("Escribe un enlace válido");
      if (links.some((link) => normalizedUrl(link.url) === normalizedUrl(url) && !link.archived)) throw new Error("Este enlace ya existe");
      const timestamp = now();
      const link = { id: id("link"), url, title: String(payload.title || url).trim(), description: String(payload.description || ""), thumbnail: String(payload.thumbnail || ""), platform: hostFromUrl(url), tags: Array.isArray(payload.tags) ? payload.tags : [], categoryId: payload.categoryId || null, status: "confirmado", confidence: 0, source: "android", sourceSheet: "", sourceCell: "", createdAt: timestamp, updatedAt: timestamp, archived: false, archivedAt: "" };
      links.unshift(link);
      writeDatabase(database);
      return { ok: true, link };
    }
    if (pathname === "/api/links" && method === "DELETE") {
      const ids = [...new Set((Array.isArray(payload.ids) ? payload.ids : []).map(String).filter(Boolean))];
      if (!ids.length) throw new Error("Selecciona al menos un enlace");
      const archivedLinks = [];
      const deletedIds = [];
      const timestamp = now();
      for (const link of links) {
        if (!ids.includes(String(link.id))) continue;
        if (link.archived) deletedIds.push(link.id);
        else { link.archived = true; link.archivedAt = timestamp; link.status = "archivado"; link.updatedAt = timestamp; archivedLinks.push(link); }
      }
      database.links = links.filter((link) => !deletedIds.includes(link.id));
      writeDatabase(database);
      return { ok: true, processed: ids.length, archivedLinks, deletedIds };
    }
    if (linkRestoreMatch && method === "POST") {
      const link = links.find((item) => item.id === linkRestoreMatch[1]);
      if (!link) throw new Error("Enlace no encontrado");
      link.archived = false; link.archivedAt = ""; link.status = "confirmado"; link.updatedAt = now();
      writeDatabase(database);
      return { ok: true, link };
    }
    if (linkMatch) {
      const link = links.find((item) => item.id === linkMatch[1]);
      if (!link) throw new Error("Enlace no encontrado");
      if (method === "PATCH") {
        if (payload.title !== undefined) link.title = String(payload.title).trim() || link.url;
        if (payload.description !== undefined) link.description = String(payload.description);
        if (payload.categoryId !== undefined) link.categoryId = payload.categoryId || null;
        link.updatedAt = now(); writeDatabase(database); return { ok: true, link };
      }
      if (method === "DELETE") {
        if (parsed.searchParams.get("permanent") === "1" || link.archived) database.links = links.filter((item) => item.id !== link.id);
        else { link.archived = true; link.archivedAt = now(); link.status = "archivado"; link.updatedAt = now(); }
        writeDatabase(database); return { ok: true, deleted: !database.links.some((item) => item.id === link.id), link };
      }
    }
    if (pathname === "/api/trash/links" && method === "DELETE") {
      const deletedIds = links.filter((link) => link.archived).map((link) => link.id);
      database.links = links.filter((link) => !link.archived); writeDatabase(database);
      return { ok: true, deleted: deletedIds.length, deletedIds };
    }

    const categoryMatch = pathname.match(/^\/api\/categories\/([^/]+)$/);
    const categoryRestoreMatch = pathname.match(/^\/api\/categories\/([^/]+)\/restore$/);
    if (pathname === "/api/categories" && method === "POST") {
      const name = String(payload.name || "").trim(); if (!name) throw new Error("Escribe un nombre para la carpeta");
      const existing = database.categories.find((item) => !item.archived && item.name.toLowerCase() === name.toLowerCase() && (item.groupId || null) === (payload.groupId || null));
      const category = existing || { id: id("category"), name, slug: name.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""), parentId: payload.parentId || null, groupId: payload.groupId || null, source: "android", createdAt: now(), updatedAt: now(), archived: false, archivedAt: "", archivedBy: "" };
      if (!existing) database.categories.push(category); writeDatabase(database); return { ok: true, category };
    }
    if (categoryRestoreMatch && method === "POST") {
      const category = findCategory(database, categoryRestoreMatch[1]); if (!category) throw new Error("Carpeta no encontrada");
      category.archived = false; category.archivedAt = ""; category.updatedAt = now(); for (const link of links.filter((item) => item.archivedByCategoryId === category.id)) { link.archived = false; link.archivedAt = ""; link.status = "confirmado"; delete link.archivedByCategoryId; }
      writeDatabase(database); return { ok: true, category };
    }
    if (categoryMatch) {
      const category = findCategory(database, categoryMatch[1]); if (!category) throw new Error("Carpeta no encontrada");
      if (method === "PATCH") { if (payload.name) category.name = String(payload.name).trim(); if ("groupId" in payload) category.groupId = payload.groupId || null; category.updatedAt = now(); writeDatabase(database); return { ok: true, category }; }
      if (method === "DELETE") {
        if (parsed.searchParams.get("permanent") === "1") { database.categories = database.categories.filter((item) => item.id !== category.id); database.links = links.filter((link) => link.categoryId !== category.id); }
        else { category.archived = true; category.archivedAt = now(); for (const link of links.filter((item) => item.categoryId === category.id && !item.archived)) { link.archived = true; link.archivedAt = now(); link.status = "archivado"; link.archivedByCategoryId = category.id; } }
        writeDatabase(database); return { ok: true, deleted: parsed.searchParams.get("permanent") === "1", category };
      }
    }

    const groupMatch = pathname.match(/^\/api\/groups\/([^/]+)$/);
    const groupRestoreMatch = pathname.match(/^\/api\/groups\/([^/]+)\/restore$/);
    if (pathname === "/api/groups" && method === "POST") {
      const name = String(payload.name || "").trim(); if (!name) throw new Error("Escribe un nombre para el grupo");
      let group = database.groups.find((item) => !item.archived && item.name.toLowerCase() === name.toLowerCase());
      if (!group) { group = { id: id("group"), name, createdAt: now(), updatedAt: now(), archived: false, archivedAt: "" }; database.groups.push(group); writeDatabase(database); }
      return { ok: true, group };
    }
    if (groupRestoreMatch && method === "POST") {
      const group = findGroup(database, groupRestoreMatch[1]); if (!group) throw new Error("Grupo no encontrado");
      group.archived = false; group.archivedAt = ""; for (const category of database.categories.filter((item) => item.groupId === group.id)) category.archived = false; for (const link of links) if (link.archivedByGroupId === group.id) { link.archived = false; link.archivedAt = ""; link.status = "confirmado"; delete link.archivedByGroupId; } writeDatabase(database); return { ok: true, group };
    }
    if (groupMatch) {
      const group = findGroup(database, groupMatch[1]); if (!group) throw new Error("Grupo no encontrado");
      if (method === "PATCH") { group.name = String(payload.name || group.name).trim(); group.updatedAt = now(); writeDatabase(database); return { ok: true, group }; }
      if (method === "DELETE") {
        const categoryIds = new Set(database.categories.filter((item) => item.groupId === group.id).map((item) => item.id));
        if (parsed.searchParams.get("permanent") === "1") { database.groups = database.groups.filter((item) => item.id !== group.id); database.categories = database.categories.filter((item) => !categoryIds.has(item.id)); database.links = links.filter((link) => !categoryIds.has(link.categoryId)); }
        else { group.archived = true; group.archivedAt = now(); for (const category of database.categories) if (categoryIds.has(category.id)) category.archived = true; for (const link of links) if (categoryIds.has(link.categoryId) && !link.archived) { link.archived = true; link.archivedAt = now(); link.status = "archivado"; link.archivedByGroupId = group.id; } }
        writeDatabase(database); return { ok: true, deleted: parsed.searchParams.get("permanent") === "1", group };
      }
    }

    if (pathname === "/api/settings" && method === "PATCH") { database.settings = { ...database.settings, ...payload, storage: { ...database.settings.storage, ...(payload.storage || {}) } }; writeDatabase(database); return { ok: true, settings: database.settings }; }
    if (pathname === "/api/import" && method === "POST") {
      const format = String(payload.format || "json").toLowerCase();
      const imported = format === "json"
        ? (typeof payload.content === "string" ? JSON.parse(payload.content) : payload.content)
        : format === "txt"
          ? textImport(payload.content)
          : csvImport(payload.content);
      const count = mergeImport(database, imported || {});
      writeDatabase(database); return { ok: true, imported: count, links: database.links.length, categories: database.categories.length };
    }
    throw new Error("Operación no disponible en Android");
  }

  window.linkotecaAndroidApi = androidApi;
  window.linkotecaAndroidExport = (format = "json") => {
    const database = readDatabase();
    if (format === "csv" || format === "xls") return csvExport(database);
    if (format === "txt") return database.links.map((link) => `${link.title || link.url}\n${link.url}`).join("\n\n");
    return JSON.stringify(exportDatabase(database), null, 2);
  };
})();
