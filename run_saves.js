// run_saves.js
// Funções de save point (checkpoint) para runs em andamento.
// Loaded as a plain <script> (not an ES module) — game.js is a classic IIFE
// script, so import/export aren't available here. Reuses the Supabase
// client game.js already creates, exposed as window.supabaseClient, instead
// of creating a second client or duplicating the URL/anon key.
// Requer a tabela `run_saves` criada via supabase_run_saves_setup.sql

const SAVE_EXPIRY_DAYS = 7;

// Identificador local do dispositivo, gerado uma vez e persistido no
// localStorage. Existe desde o primeiro acesso, independente de quando
// o jogador digita o nome (isso só acontece no fim da run, em `scores`).
function getDeviceId() {
  let id = localStorage.getItem('device_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('device_id', id);
  }
  return id;
}

const deviceId = getDeviceId();

// Signed-in players get their checkpoint keyed by account id instead of the
// device's random UUID, so starting a run on one device and closing the tab
// can be resumed by opening the game signed in on a different device — a
// guest (or a signed-in player before this existed) keeps using deviceId,
// same as always. Resolved fresh on every call rather than cached once,
// since sign-in/out can happen mid-session (see initAuthWidget() in game.js).
async function getEffectivePlayerId() {
  if (!window.supabaseClient) return deviceId;
  try {
    const { data: { session } } = await window.supabaseClient.auth.getSession();
    return session?.user?.id || deviceId;
  } catch (e) {
    return deviceId;
  }
}

// Chamar em checkpoints relevantes durante a run (badge conquistada,
// elite four batida, etc.) para atualizar o save.
async function saveCheckpoint(gameState) {
  const playerId = await getEffectivePlayerId();
  const { error } = await window.supabaseClient.from('run_saves').upsert(
    {
      player_id: playerId,
      state: gameState,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'player_id' }
  );

  if (error) console.error('Erro ao salvar checkpoint:', error);
}

// Chamar ao abrir o jogo, antes da tela de nome, para checar se existe
// um save válido a oferecer como "Continuar run anterior". Retorna o
// `state` salvo, ou `null` se não existir ou estiver expirado (>7 dias).
async function loadCheckpoint() {
  const playerId = await getEffectivePlayerId();
  const { data, error } = await window.supabaseClient
    .from('run_saves')
    .select('state, updated_at')
    .eq('player_id', playerId)
    .maybeSingle();

  if (error) {
    console.error('Erro ao carregar checkpoint:', error);
    return null;
  }

  if (!data) return null;

  const updatedAt = new Date(data.updated_at);
  const ageInDays = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);

  if (ageInDays > SAVE_EXPIRY_DAYS) {
    // Save expirado — apaga e trata como se não existisse.
    await clearCheckpoint();
    return null;
  }

  return data.state;
}

// Chamar quando a run termina (vitória ou derrota), logo após gravar
// o resultado em `scores`. Garante que o save não pode ser recarregado
// depois que a run já foi contabilizada.
async function clearCheckpoint() {
  const playerId = await getEffectivePlayerId();
  const { error } = await window.supabaseClient
    .from('run_saves')
    .delete()
    .eq('player_id', playerId);

  if (error) console.error('Erro ao limpar checkpoint:', error);
}

// No export — plain script (not a module), so these are already global
// functions, callable directly from game.js the same way its own functions
// call each other.
