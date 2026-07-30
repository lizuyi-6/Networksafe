# Inference-path ablation

Status: **NOT_RUN**

The one-factor-at-a-time matrix was locked before results, but the execution
environment contains neither the merged/f16 shared-weight artifacts nor an
Ollama or llama.cpp runtime. Historical metrics use a different test set and
configuration, so they are not copied into this 413-sample experiment and
cannot support a causal claim about FPR.

The locked factors are:

1. Transformers `max_context_tokens=2048` versus Ollama `num_ctx=2048`;
2. byte-identical system prompt, SHA-256
   `9b07be6e2cf57443232df24ffde5f7765a1b071029eaf86c06724ed6182a4cd8`;
3. `system + user` versus one concatenated prompt;
4. `tokenizer.apply_chat_template` versus the Ollama Modelfile template;
5. temperature 0, top-p 1, disabled top-k where supported, and seed 0.

No conclusion is reported for context truncation, system prompt, chat template,
message serialization, sampling, runtime, or quantization.
