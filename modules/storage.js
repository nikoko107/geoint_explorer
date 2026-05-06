/**
 * Abstraction localStorage avec gestion du quota.
 * Toutes les lectures/écritures de l'app passent par ce module.
 */

let _onQuotaWarning = null;
let _onQuotaCritical = null;

export function initStorage({ onQuotaWarning, onQuotaCritical } = {}) {
  _onQuotaWarning = onQuotaWarning || null;
  _onQuotaCritical = onQuotaCritical || null;
}

export function storageGet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storageSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (isQuotaError(e)) {
      _onQuotaWarning?.();
      // Nettoyage FIFO navLog sur tous les projets connus
      pruneNavLogs();
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e2) {
        if (isQuotaError(e2)) {
          _onQuotaCritical?.();
        }
        return false;
      }
    }
    return false;
  }
}

export function storageRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // rien
  }
}

function isQuotaError(e) {
  return (
    e instanceof DOMException &&
    (e.code === 22 ||
      e.code === 1014 ||
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  );
}

/**
 * Supprime les 20 entrées navLog les plus anciennes sur chaque projet
 * pour libérer de l'espace.
 */
function pruneNavLogs() {
  const index = storageGet('geoint_index') || [];
  for (const id of index) {
    const project = storageGet(`geoint_project_${id}`);
    if (!project || !Array.isArray(project.navLog) || project.navLog.length <= 20) continue;
    project.navLog = project.navLog.slice(20);
    try {
      localStorage.setItem(`geoint_project_${id}`, JSON.stringify(project));
    } catch {
      // Si ça échoue encore, on laisse passer
    }
  }
}

/**
 * Estime l'espace utilisé par le localStorage (en octets, approximatif).
 */
export function storageUsedBytes() {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const val = localStorage.getItem(key);
    total += (key.length + val.length) * 2; // UTF-16
  }
  return total;
}
