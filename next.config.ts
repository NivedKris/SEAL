import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local embeddings: keep the ONNX runtime's native binaries out of the bundle.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  // Files read at runtime (prompts, the ICD-10-CM list) must ship with the functions.
  outputFileTracingIncludes: { "/**": ["./prompts/**/*.md", "./research/R5/codes/icd10cm_2027_full.json.gz"] },
  // Vercel functions run on Linux x64 (250 MB limit): drop the ONNX binaries for other platforms and the web runtime.
  outputFileTracingExcludes: {
    "/**": [
      "./node_modules/onnxruntime-node/bin/napi-v3/darwin/**",
      "./node_modules/onnxruntime-node/bin/napi-v3/win32/**",
      "./node_modules/onnxruntime-node/bin/napi-v3/linux/arm64/**",
      "./node_modules/onnxruntime-web/**",
      "./node_modules/@huggingface/transformers/dist/*.map",
      "./node_modules/@huggingface/transformers/dist/*.wasm",
      "./.cache/**",
      "./scripts/**",
      "./research/R5/codes/icd10cm_2027_seal.json",
    ],
  },
};

export default nextConfig;
