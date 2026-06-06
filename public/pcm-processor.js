/**
 * AudioWorklet processor that accumulates audio samples into fixed-size
 * buffers and posts them to the main thread as Float32Arrays.
 *
 * Usage:
 *   await audioContext.audioWorklet.addModule('/pcm-processor.js');
 *   const node = new AudioWorkletNode(audioContext, 'pcm-processor', {
 *     processorOptions: { bufferSize: 2560 }  // ~160ms @ 16kHz
 *   });
 */
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.bufferSize = options.processorOptions?.bufferSize || 2560;
    this.buffer = new Float32Array(this.bufferSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channel = input[0];
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset >= this.bufferSize) {
        this.port.postMessage(this.buffer.slice());
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
