let primedAudioContext = null;

export async function primeDemosceneAudio() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;

    if (!primedAudioContext || primedAudioContext.state === 'closed') {
      primedAudioContext = new AudioContext();
    }

    await primedAudioContext.resume();
    return primedAudioContext;
  } catch {
    return null;
  }
}

export function takePrimedDemosceneAudio() {
  const audioContext = primedAudioContext;
  primedAudioContext = null;
  return audioContext;
}
