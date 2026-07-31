[DATE]

Editor-in-Chief
Journal of Information Security and Applications

Dear Editor-in-Chief,

Please consider my manuscript, “AetherArgus: Leakage-Controlled and Reproducible Evaluation of a Compact Language Model for HTTP Security Classification,” for publication as a Research Article in the Journal of Information Security and Applications.

The manuscript studies whether a compact, locally deployable language model can improve request-side HTTP security classification under a frozen external evaluation protocol. AetherArgus is a 4B-parameter QLoRA-adapted model that produces structured safe, attack, or unknown decisions. The evaluation compares eight systems on the same 413 authorized LAN challenge requests, including a frozen rule baseline, a character n-gram classifier, zero-shot and fixed few-shot Qwen3-4B baselines, and four AetherArgus inference artifacts.

The principal contribution is not a claim of production-ready autonomous blocking. Instead, the work combines task adaptation with a leakage-controlled and auditable evaluation design. Prediction and scoring are isolated; the challenge set is excluded from training, prompt selection, threshold selection, and model selection; per-sample outputs and statistical evidence are preserved; and the frozen labels were subsequently confirmed through a confidential blind human review with zero changes.

AetherArgus improves macro-F1 from 0.4175 for zero-shot Qwen3-4B to 0.4658, with a paired difference of 0.0482 and a 95% confidence interval of 0.0113–0.0835. Attack recall reaches 0.9072. The manuscript also reports deployment-relevant negative results: the safe false-positive rate remains 20.57%, unknown recall is zero, and message structure changes 11 of 413 verdicts. These findings support shadow-mode or second-stage use while directly rejecting autonomous enforcement claims.

I believe the manuscript fits JISA’s emphasis on original and practice-driven information-security research because it addresses network and application security, model robustness, reproducibility, operational false positives, and responsible deployment. The complete source, protocols, statistical outputs, and claim-to-evidence mappings are maintained in the associated repository. Operationally sensitive raw captures and confidential reviewer worksheets are not publicly released, and this limitation is stated in the manuscript.

The manuscript is original, has not been published previously, and is not under consideration elsewhere. I approve the final version and take responsibility for the integrity of the work. Funding and competing interests will be declared through the submission system and in the final manuscript. The use of OpenAI ChatGPT for manuscript organization, language drafting, and consistency checking is disclosed in accordance with Elsevier policy; I reviewed and verified the content and retain full responsibility for it.

Thank you for considering this manuscript.

Sincerely,

Zuyi Li
[CORRESPONDING AUTHOR AFFILIATION]
[POSTAL ADDRESS]
2251213429@qq.com
[PHONE]
