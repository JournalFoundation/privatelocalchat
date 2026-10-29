// Connect the existing content-free worker counters to Emdawn's actual creation sites.
// Keep this transformation exclusive to the development runtime.
export function instrumentWebGpu(source) {
  const replacements = [
    ['buffer=device.createBuffer(desc)', 'buffer=device.createBuffer(desc);globalThis.__flightGpuBufferCreated?.(desc.size)'],
    ['device.createComputePipeline(desc)', '((pipeline)=>{globalThis.__flightGpuPipelineCreated?.();return pipeline;})(device.createComputePipeline(desc))']
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) throw new Error('WebGPU instrumentation site changed: '+before);
    source = source.replace(before, after);
  }
  return source;
}
