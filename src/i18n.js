// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, buttons, badges), in English and
// French. Never put the password in one of them.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Why the box is unreachable, with the hint that fits. */
function unreachable(err) {
  const reason = err?.message ?? 'unknown error';
  const hints = {
    certificate: {
      en: 'The HC3 and the Yubii Home use a self-signed certificate: turn off "Verify the TLS certificate", or use http://.',
      fr: 'Le HC3 et la Yubii Home utilisent un certificat auto-signé : désactivez « Vérifier le certificat TLS », ou utilisez http://.',
    },
    redirect: {
      en: 'Type the address the box redirects to (https:// when the box only accepts HTTPS).',
      fr: "Saisissez l'adresse vers laquelle la box redirige (https:// quand la box n'accepte que HTTPS).",
    },
    http: {
      en: 'Check the address of the box.',
      fr: "Vérifiez l'adresse de la box.",
    },
    format: {
      en: 'Is it the address of your Fibaro or Yubii box?',
      fr: "Est-ce bien l'adresse de votre box Fibaro ou Yubii ?",
    },
  };
  const hint = hints[err?.kind] ?? {
    en: 'Use its LAN IP address (not localhost). Retrying in a few seconds.',
    fr: 'Utilisez son adresse IP sur le réseau local (pas localhost). Nouvel essai dans quelques secondes.',
  };
  return {
    en: `The Fibaro box is unreachable: ${reason}. ${hint.en}`,
    fr: `La box Fibaro est injoignable : ${reason}. ${hint.fr}`,
  };
}

export const T = {
  notConfigured: {
    en: 'Type the address of your box (for example http://192.168.1.50), its user name and password in the configuration.',
    fr: "Saisissez l'adresse de votre box (par exemple http://192.168.1.50), son nom d'utilisateur et son mot de passe dans la configuration.",
  },
  noUser: {
    en: 'Type the user name of the box (the one you log in to its web interface with) in the configuration.',
    fr: "Saisissez le nom d'utilisateur de la box (celui de son interface web) dans la configuration.",
  },
  noPassword: {
    en: 'Type the password of the box user in the configuration.',
    fr: "Saisissez le mot de passe de l'utilisateur de la box dans la configuration.",
  },
  badUrl: (reason) =>
    reason === 'credentials'
      ? {
          en: 'No user name or password in the address: they have their own fields.',
          fr: "Pas d'utilisateur ni de mot de passe dans l'adresse : ils ont leurs propres champs.",
        }
      : {
          en: 'The address of the box is not valid: use http://192.168.1.50 or https://192.168.1.50.',
          fr: "L'adresse de la box n'est pas valide : utilisez http://192.168.1.50 ou https://192.168.1.50.",
        },
  /** The status of a configuration error (see normalizeConfig). */
  configError(error) {
    if (error === 'empty') {
      return T.notConfigured;
    }
    if (error === 'no-user') {
      return T.noUser;
    }
    return error === 'no-password' ? T.noPassword : T.badUrl(error);
  },
  connecting: {
    en: 'Connecting to the Fibaro box…',
    fr: 'Connexion à la box Fibaro…',
  },
  connected: (model, devices) => ({
    en: `Connected to the ${model.name} (firmware ${model.version || '?'}): ${plural(devices, 'device', 'devices')} in Discovery.`,
    fr: `Connecté à la ${model.name} (firmware ${model.version || '?'}) : ${plural(devices, 'appareil', 'appareils')} dans Découverte.`,
  }),
  /** The status of a failed call (a FibaroError). */
  failure(err) {
    if (err?.kind === 'auth') {
      return {
        en: 'The box refused the user name or the password: type them again in the configuration (the account you log in to the box with).',
        fr: "La box a refusé le nom d'utilisateur ou le mot de passe : saisissez-les à nouveau dans la configuration (le compte de connexion à la box).",
      };
    }
    if (err?.kind === 'forbidden') {
      return {
        en: 'The box refused the access (HTTP 403): check the user name and password, and that this user may see the devices (an administrator is the simplest). After repeated failed logins, the box blocks the address for a while.',
        fr: "La box a refusé l'accès (HTTP 403) : vérifiez le nom d'utilisateur et le mot de passe, et que cet utilisateur voit les appareils (un administrateur est le plus simple). Après plusieurs échecs, la box bloque l'adresse un moment.",
      };
    }
    if (err?.kind === 'notfound') {
      return {
        en: 'No Fibaro API at this address (HTTP 404): is it the address of your Home Center or Yubii Home?',
        fr: "Pas d'API Fibaro à cette adresse (HTTP 404) : est-ce bien l'adresse de votre Home Center ou Yubii Home ?",
      };
    }
    return unreachable(err);
  },
  /** Transport badge of a device the box reports as dead (≤ 200 characters). */
  dead: {
    en: 'The box reports this device as dead: it no longer answers (battery, range, power).',
    fr: 'La box signale cet appareil comme mort : il ne répond plus (pile, portée, alimentation).',
  },
  test: {
    /**
     * nodes: the hidden technical parents (a Z-Wave node behind its endpoints),
     * part of `hidden` but not "left out": their endpoints are the devices.
     * emptyTypes: the types of the devices with nothing to offer (a few).
     */
    ok: ({
      model,
      devices,
      read,
      disabled,
      hidden,
      plugins,
      empty,
      scenes,
      nodes = 0,
      emptyTypes = [],
    }) => {
      const otherHidden = hidden - nodes;
      const left = disabled + otherHidden + plugins + empty;
      const total = read + disabled + hidden + plugins;
      const listed =
        emptyTypes.length > 0
          ? `${emptyTypes.slice(0, 5).join(', ')}${emptyTypes.length > 5 ? '…' : ''}`
          : '';
      const types = listed && `: ${listed}`;
      const typesFr = listed && ` : ${listed}`;
      return {
        en:
          `Connection OK, ${model.name} (firmware ${model.version || '?'}, API v${model.api}): ` +
          `${plural(total, 'device', 'devices')}, ${plural(scenes, 'scene', 'scenes')}. ` +
          `${plural(devices, 'device', 'devices')} offered in Discovery` +
          (nodes > 0
            ? `, ${plural(nodes, 'technical node', 'technical nodes')} of the box not shown (normal: their endpoints are the devices)`
            : '') +
          (left > 0
            ? `, ${left} left out (${disabled} disabled, ${otherHidden} hidden, ${plugins} plugins or Quick Apps, ${empty} with nothing to offer${types}).`
            : '.'),
        fr:
          `Connexion OK, ${model.name} (firmware ${model.version || '?'}, API v${model.api}) : ` +
          `${plural(total, 'appareil', 'appareils')}, ${plural(scenes, 'scène', 'scènes')}. ` +
          `${plural(devices, 'appareil proposé', 'appareils proposés')} dans Découverte` +
          (nodes > 0
            ? `, ${plural(nodes, 'nœud technique', 'nœuds techniques')} de la box non affiché${nodes === 1 ? '' : 's'} (normal : leurs sous-appareils sont les appareils)`
            : '') +
          (left > 0
            ? `, ${left} écarté${left === 1 ? '' : 's'} (${disabled} désactivé${disabled === 1 ? '' : 's'}, ${otherHidden} masqué${otherHidden === 1 ? '' : 's'}, ${plugins} plugins ou Quick Apps, ${empty} sans rien à proposer${typesFr}).`
            : '.'),
      };
    },
  },
  scenes: {
    none: {
      en: 'The box has no visible scene.',
      fr: "La box n'a aucune scène visible.",
    },
    list: (scenes, more) => {
      const lines = scenes.map((s) => `${s.id}: ${s.name}`).join(' · ');
      return {
        en: `Scene numbers for the "Run a Fibaro scene" action: ${lines}${more > 0 ? ` (and ${more} more)` : ''}.`,
        fr: `Numéros des scènes pour l'action « Lancer une scène Fibaro » : ${lines}${more > 0 ? ` (et ${more} autres)` : ''}.`,
      };
    },
  },
  notConnected: {
    en: 'The Fibaro box is not connected',
    fr: "La box Fibaro n'est pas connectée",
  },
};
