(function () {
  // Replaced by the bridge with the origin serving this WPS add-in.
  var BRIDGE_ORIGIN = '__WPS_REVIEWER_BRIDGE_ORIGIN__';
  var MAX_CHUNK_LENGTH = 32000;
  var CHANGE_DEBOUNCE_MS = 300;
  var HEARTBEAT_MS = 3000;

  var state = {
    started: false,
    app: null,
    clientId: 'wps_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    runtimeId: 'runtime_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
    commandSource: null,
    debounceTimer: null,
    heartbeatTimer: null,
    revisionByHandle: {},
    documentIdentityByHandle: {},
    documentHandlesByPath: {},
    documentHandles: typeof WeakMap === 'function' ? new WeakMap() : null,
    documentHandleEntries: []
  };

  function requestJson(path, options) {
    return fetch(BRIDGE_ORIGIN + path, {
      method: options && options.method ? options.method : 'GET',
      headers: { 'content-type': 'application/json' },
      body: options && options.body ? JSON.stringify(options.body) : undefined
    }).then(function (response) {
      if (!response.ok) throw new Error('Bridge request failed: ' + response.status);
      return response.json().catch(function () {
        return {};
      });
    });
  }

  function getActiveDocument() {
    return state.app && state.app.ActiveDocument ? state.app.ActiveDocument : null;
  }

  function readCollectionCount(collection) {
    var keys = ['Count', 'count', 'Length', 'length'];
    for (var i = 0; i < keys.length; i += 1) {
      var key = keys[i];
      if (!collection || typeof collection[key] === 'undefined') continue;
      try {
        var raw = typeof collection[key] === 'function' ? collection[key]() : collection[key];
        var value = Number(raw);
        if (isFinite(value)) return value;
      } catch (error) {
        // Try the next WPS collection spelling.
      }
    }
    return null;
  }

  function getCollectionItem(collection, index) {
    var methods = ['Item', 'item', 'GetItem', 'get_Item'];
    for (var i = 0; i < methods.length; i += 1) {
      var method = methods[i];
      if (!collection || typeof collection[method] !== 'function') continue;
      try {
        var item = collection[method](index);
        if (item) return item;
      } catch (error) {
        // Some WPS builds are one-based while others expose zero-based items.
      }
    }
    try {
      if (collection && collection[index]) return collection[index];
    } catch (error) {
      // Ignore unavailable index accessors.
    }
    return null;
  }

  function getOpenDocuments() {
    var documents = [];
    var collection = state.app && state.app.Documents;
    var count = readCollectionCount(collection);

    function addDocument(doc) {
      if (!doc) return;
      for (var i = 0; i < documents.length; i += 1) {
        if (documents[i] === doc) return;
        var currentPath = normalizeDocumentPath(doc && (doc.FullName || doc.Path));
        var existingPath = normalizeDocumentPath(documents[i] && (documents[i].FullName || documents[i].Path));
        if (currentPath && existingPath && currentPath === existingPath) return;
        try {
          if (getDocumentHandle(doc) === getDocumentHandle(documents[i])) return;
        } catch (error) {
          // Keep the object when WPS does not expose enough identity yet.
        }
      }
      documents.push(doc);
    }

    if (count !== null) {
      for (var zeroBased = 0; zeroBased < count; zeroBased += 1) {
        addDocument(getCollectionItem(collection, zeroBased));
      }
      for (var oneBased = 1; oneBased <= count; oneBased += 1) {
        addDocument(getCollectionItem(collection, oneBased));
      }
    } else if (Array.isArray(collection)) {
      for (var index = 0; index < collection.length; index += 1) addDocument(collection[index]);
    }

    addDocument(getActiveDocument());
    return documents;
  }

  function hashString(value) {
    var hash = 5381;
    var text = String(value || '');
    for (var i = 0; i < text.length; i += 1) {
      hash = (hash * 33) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
  }

  function getDocumentHandle(doc) {
    var stablePath = normalizeDocumentPath(doc && (doc.FullName || doc.Path));
    if (state.documentHandles) {
      if (!state.documentHandles.has(doc)) {
        var pathHandle = stablePath && state.documentHandlesByPath[stablePath];
        var handle = pathHandle || ('wpsdoc_' + state.runtimeId + '_' + Math.random().toString(36).slice(2, 10));
        state.documentHandles.set(doc, handle);
        if (stablePath) state.documentHandlesByPath[stablePath] = handle;
      }
      return state.documentHandles.get(doc);
    }

    for (var index = 0; index < state.documentHandleEntries.length; index += 1) {
      if (state.documentHandleEntries[index].document === doc) {
        return state.documentHandleEntries[index].handle;
      }
    }

    if (stablePath && state.documentHandlesByPath[stablePath]) return state.documentHandlesByPath[stablePath];
    var fallbackHandle = 'wpsdoc_' + state.runtimeId + '_' + Math.random().toString(36).slice(2, 10);
    state.documentHandleEntries.push({ document: doc, handle: fallbackHandle });
    if (stablePath) state.documentHandlesByPath[stablePath] = fallbackHandle;
    return fallbackHandle;
  }

  function getDocumentText(doc) {
    if (!doc) return '';
    if (doc.Content && typeof doc.Content.Text === 'string') return doc.Content.Text;
    if (doc.Content && typeof doc.Content.Text !== 'undefined') return String(doc.Content.Text || '');
    if (typeof doc.GetDocumentRange === 'function') {
      var range = doc.GetDocumentRange();
      return String((range && range.Text) || '');
    }
    return '';
  }

  function getDocumentTitle(doc) {
    return String((doc && (doc.Name || doc.FullName)) || 'WPS Document');
  }

  function getDocumentFullName(doc) {
    return String((doc && (doc.FullName || doc.Path)) || '');
  }

  function normalizeDocumentPath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').trim().toLowerCase();
  }

  function getDocumentIdentity(doc) {
    var handle = getDocumentHandle(doc);
    if (state.documentIdentityByHandle[handle]) return state.documentIdentityByHandle[handle];
    var fullName = normalizeDocumentPath(getDocumentFullName(doc));
    var identity = fullName
      ? { documentKey: 'path:' + fullName, identityKind: 'path' }
      : { documentKey: 'session:' + state.clientId + ':' + handle, identityKind: 'session' };
    state.documentIdentityByHandle[handle] = identity;
    return identity;
  }

  function getSelectionText(app) {
    var selection = app && (app.Selection || app.selection);
    var ranges = [
      selection && selection.Range,
      selection && selection.range,
      selection
    ];
    for (var i = 0; i < ranges.length; i += 1) {
      var range = ranges[i];
      if (!range) continue;
      var candidates = [range.Text, range.text, range.SelectionText, range.selectionText];
      for (var j = 0; j < candidates.length; j += 1) {
        if (typeof candidates[j] === 'string') return candidates[j].slice(0, 2000);
      }
    }
    return '';
  }

  function readChunk(text, offset, limit) {
    var safeOffset = Math.max(0, Number(offset) || 0);
    var safeLimit = Math.min(MAX_CHUNK_LENGTH, Math.max(1, Number(limit) || MAX_CHUNK_LENGTH));
    var chunk = String(text || '').slice(safeOffset, safeOffset + safeLimit);
    return {
      text: chunk,
      nextOffset: safeOffset + chunk.length,
      done: safeOffset + chunk.length >= String(text || '').length
    };
  }

  async function sha256(text) {
    if (typeof crypto === 'undefined' || !crypto.subtle || typeof TextEncoder === 'undefined') {
      return 'fallback-' + hashString(text);
    }
    var bytes = new TextEncoder().encode(String(text || ''));
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map(function (byte) {
        return byte.toString(16).padStart(2, '0');
      })
      .join('');
  }

  function buildDocumentMetadata(doc, options) {
    var handle = getDocumentHandle(doc);
    var textLength = 0;
    try {
      textLength = getDocumentText(doc).length;
    } catch (error) {
      textLength = 0;
    }

    if (options && options.invalidateRevision) {
      state.revisionByHandle[handle] = '';
    }

    var active = doc === getActiveDocument();
    var identity = getDocumentIdentity(doc);
    return {
      clientId: state.clientId,
      documentHandle: handle,
      documentKey: identity.documentKey,
      identityKind: identity.identityKind,
      title: getDocumentTitle(doc),
      fullName: getDocumentFullName(doc),
      textLength: textLength,
      selectionText: active ? getSelectionText(state.app) : '',
      revisionToken: state.revisionByHandle[handle] || '',
      lastSeenAt: Date.now(),
      isActive: active,
      lastActiveAt: active ? Date.now() : 0
    };
  }

  async function registerDocument(doc, options) {
    if (!doc) return null;
    return requestJson('/api/wps/documents/register', {
      method: 'POST',
      body: buildDocumentMetadata(doc, options || {})
    }).catch(function () {
      return null;
    });
  }

  async function registerActiveDocument(options) {
    var doc = getActiveDocument();
    if (!doc) return null;
    return requestJson('/api/wps/documents/active', {
      method: 'POST',
      body: buildDocumentMetadata(doc, options || {})
    }).catch(function () {
      return null;
    });
  }

  async function registerOpenDocuments(options) {
    var documents = getOpenDocuments();
    var active = getActiveDocument();
    for (var i = 0; i < documents.length; i += 1) {
      if (sameDocument(documents[i], active)) await registerActiveDocument(options || {});
      else await registerDocument(documents[i], options || {});
    }
    return documents.length;
  }

  function scheduleRegister(options) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(function () {
      registerOpenDocuments(options || {});
    }, options && options.immediate ? 0 : CHANGE_DEBOUNCE_MS);
  }

  function startHeartbeat() {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = setInterval(function () {
      registerOpenDocuments({ heartbeat: true });
    }, HEARTBEAT_MS);
  }

  function findDocumentByHandle(documentHandle) {
    var documents = getOpenDocuments();
    for (var i = 0; i < documents.length; i += 1) {
      if (getDocumentHandle(documents[i]) === documentHandle) return documents[i];
    }
    return null;
  }

  function sameDocument(left, right) {
    if (!left || !right) return false;
    if (left === right) return true;
    try {
      return getDocumentHandle(left) === getDocumentHandle(right);
    } catch (error) {
      return false;
    }
  }

  async function waitForActiveDocument(doc, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 1000);
    while (Date.now() <= deadline) {
      if (sameDocument(getActiveDocument(), doc)) return true;
      await new Promise(function (resolve) { setTimeout(resolve, 50); });
    }
    return false;
  }

  async function activateDocument(doc) {
    if (!doc || sameDocument(doc, getActiveDocument())) return;
    var attempts = [];
    if (typeof doc.Activate === 'function') attempts.push(function () { return doc.Activate(); });
    if (typeof doc.activate === 'function') attempts.push(function () { return doc.activate(); });
    if (state.app && typeof state.app.ActivateDocument === 'function') {
      attempts.push(function () { return state.app.ActivateDocument(doc); });
    }
    if (state.app && typeof state.app.Activate === 'function') {
      attempts.push(function () { return state.app.Activate(doc); });
    }

    var firstError = null;
    for (var i = 0; i < attempts.length; i += 1) {
      try {
        var methodResult = attempts[i]();
        if (methodResult && typeof methodResult.then === 'function') await methodResult;
        if (await waitForActiveDocument(doc, 1000)) return;
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }
    if (firstError) throw firstError;
    if (!attempts.length) throw new Error('当前 WPS 运行时未暴露文档激活 API');
    throw new Error('WPS 未能确认目标文档已激活');
  }

  async function handleActivateCommand(command) {
    var payload = command.payload || {};
    var doc = findDocumentByHandle(payload.documentHandle);
    if (!doc) throw new Error('Requested WPS document is not open');
    await activateDocument(doc);
    await registerActiveDocument({ immediate: true });
    if (!sameDocument(getActiveDocument(), doc)) throw new Error('WPS 未能确认目标文档已激活');
    return {
      documentHandle: getDocumentHandle(doc),
      title: getDocumentTitle(doc),
      fullName: getDocumentFullName(doc),
      selectionText: getSelectionText(state.app)
    };
  }

  async function handleReadCommand(command) {
    var payload = command.payload || {};
    var doc = findDocumentByHandle(payload.documentHandle);
    if (!doc) throw new Error('Requested WPS document is not open');
    var text = getDocumentText(doc);
    var chunk = readChunk(text, payload.offset, payload.limit);
    var digest = await sha256(text);
    var revisionToken = 'sha256:' + payload.documentHandle + ':' + text.length + ':' + digest;
    state.revisionByHandle[payload.documentHandle] = revisionToken;

    return {
      text: chunk.text,
      nextOffset: chunk.nextOffset,
      done: chunk.done,
      revisionToken: revisionToken
    };
  }

  async function handleCommand(command) {
    try {
      var result;
      if (command.type === 'document.read') result = await handleReadCommand(command);
      else if (command.type === 'document.activate') result = await handleActivateCommand(command);
      else return;
      await requestJson('/api/wps/commands/' + encodeURIComponent(command.id) + '/result', {
        method: 'POST',
        body: { ok: true, result: result }
      });
    } catch (error) {
      await requestJson('/api/wps/commands/' + encodeURIComponent(command.id) + '/result', {
        method: 'POST',
        body: { ok: false, error: error && error.message ? error.message : String(error) }
      }).catch(function () {});
    }
  }

  function connectCommands() {
    if (state.commandSource) state.commandSource.close();
    if (typeof EventSource !== 'function') return;

    state.commandSource = new EventSource(
      BRIDGE_ORIGIN + '/api/wps/commands?clientId=' + encodeURIComponent(state.clientId)
    );
    state.commandSource.addEventListener('command', function (event) {
      handleCommand(JSON.parse(event.data));
    });
    state.commandSource.addEventListener('error', function () {
      setTimeout(connectCommands, 1500);
    });
  }

  function addApiEventListener(apiEvent, name, listener) {
    if (!apiEvent) return;
    var methods = ['AddApiEventListener', 'addEventListener', 'Add'];
    for (var i = 0; i < methods.length; i += 1) {
      try {
        if (typeof apiEvent[methods[i]] === 'function') {
          apiEvent[methods[i]](name, listener);
          return;
        }
      } catch (error) {
        // Continue trying other WPS event shapes.
      }
    }
  }

  function bindApplicationEvents(app) {
    var onActivate = function () {
      scheduleRegister({ immediate: true });
    };
    var onChange = function () {
      scheduleRegister({ invalidateRevision: true });
    };

    addApiEventListener(app.ApiEvent, 'WindowActivate', onActivate);
    addApiEventListener(app.ApiEvent, 'DocumentChange', onChange);
    addApiEventListener(app.ApiEvent, 'DocumentViewFocusIn', onActivate);
  }

  function start(app) {
    if (state.started) return;
    state.started = true;
    state.app = app;
    bindApplicationEvents(app);
    registerOpenDocuments({ immediate: true });
    startHeartbeat();
    connectCommands();
  }

  window.WpsDocumentConnector = {
    start: start,
    readChunk: readChunk,
    sha256: sha256
  };
})();
