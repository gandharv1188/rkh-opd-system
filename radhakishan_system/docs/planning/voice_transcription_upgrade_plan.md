# Voice Transcription Upgrade Plan

**Date:** 17 March 2026
**Current:** Web Speech API (Chrome-only, `en-IN` locale, no medical vocabulary)
**Target:** OpenAI GPT-4o Transcribe with medical prompt engineering + Web Speech API fallback

---

## Current Implementation Analysis

### Prescription Pad (`web/prescription-pad.html`, line 2353)

```javascript
function toggleVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recog = new SR();
  recog.continuous = true;
  recog.interimResults = true;
  recog.lang = "en-IN";
  // ... appends final transcript to textarea
}
```

**Limitations:**

- Chrome-only (`webkitSpeechRecognition`) — fails on Firefox, Safari, Edge
- No medical vocabulary awareness — misrecognizes drug names, dosages, clinical terms
- `en-IN` only — no Hindi/Hinglish support for code-switching (doctor says "patient ko fever hai, give Paracetamol 15mg/kg")
- No prompt/context seeding — can't tell the recognizer about expected medical terms
- Free but unreliable — Google can change/deprecate Web Speech API without notice
- No offline capability

### Registration Page (`web/registration.html`, line 1589)

Same Web Speech API pattern for external records dictation. Same limitations.

---

## Option Analysis

### Option A: Wispr Flow

| Aspect              | Details                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| **What it is**      | Desktop app with AI-powered dictation (macOS, Windows, iOS, Android)                                      |
| **Accuracy**        | Close to 100% on general English, good with technical terms                                               |
| **API/SDK**         | **No public developer API or SDK** — it's a consumer/pro desktop app                                      |
| **Web integration** | Works "in any app" via OS-level input injection, but cannot be programmatically integrated into a web app |
| **Pricing**         | $12/user/month (Flow Pro)                                                                                 |
| **Medical vocab**   | No specific medical fine-tuning                                                                           |
| **Hindi**           | Supports 100+ languages but no medical Hindi prompt engineering                                           |
| **HIPAA**           | SOC 2 Type II certified, HIPAA-ready                                                                      |

**Verdict: NOT suitable for programmatic web app integration.** Wispr Flow is an excellent desktop dictation tool, but it has no API — you can't call it from JavaScript. Dr. Lokender could install it on his computer and use it to dictate into the textarea (it would type as if he were using a keyboard), but this doesn't give us medical vocabulary control, and it's a per-device install rather than a web-native solution.

### Option B: OpenAI Whisper API (whisper-1)

| Aspect               | Details                                                  |
| -------------------- | -------------------------------------------------------- |
| **What it is**       | REST API for audio transcription                         |
| **Accuracy**         | 2.7% WER on clean audio, 97% for English                 |
| **API**              | REST API — send audio file, get text back                |
| **Streaming**        | **NOT supported** — batch only                           |
| **Prompt parameter** | Limited to last 224 tokens                               |
| **Pricing**          | $0.006/min (~₹0.50/min)                                  |
| **Hindi**            | Supported, handles code-switching well                   |
| **Medical vocab**    | Basic — prompt parameter helps but limited to 224 tokens |

**Verdict: Good accuracy, but no streaming = poor UX for real-time dictation.** Doctor would have to record, wait, then see text. Not suitable for live dictation.

### Option C: OpenAI GPT-4o Transcribe (RECOMMENDED)

| Aspect               | Details                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| **What it is**       | Next-gen transcription model with full GPT-4o context understanding                                    |
| **Accuracy**         | Better than Whisper on medical/specialized vocabulary                                                  |
| **API**              | REST API with **streaming support** (`stream=true`)                                                    |
| **Prompt parameter** | **Full GPT-4o context window** — can include extensive medical vocabulary, patient context, drug names |
| **Pricing**          | $0.006/min (~₹0.50/min) — same as Whisper                                                              |
| **Hindi**            | Supported, excels at code-switching (Hindi-English mix)                                                |
| **Medical vocab**    | **Excellent** — large prompt window allows seeding with drug names, clinical terms, dosing patterns    |
| **Real-time**        | Streaming transcription via `stream=true` parameter                                                    |
| **Formats**          | mp3, mp4, wav, webm — browser MediaRecorder outputs webm natively                                      |

**Verdict: BEST option. Same price as Whisper, but with streaming, larger prompt window for medical vocabulary, and better accuracy on specialized terms.**

### Option D: OpenAI Realtime API (WebRTC/WebSocket)

| Aspect         | Details                                                              |
| -------------- | -------------------------------------------------------------------- |
| **What it is** | True real-time streaming via WebSocket/WebRTC                        |
| **Accuracy**   | Uses GPT-4o models                                                   |
| **API**        | WebSocket at `wss://api.openai.com/v1/realtime?intent=transcription` |
| **Latency**    | Lowest — true real-time with VAD (Voice Activity Detection)          |
| **Pricing**    | Higher — audio tokens pricing model                                  |
| **Complexity** | Higher — requires WebSocket management                               |

**Verdict: Overkill for our use case. The streaming REST API from Option C is sufficient for dictation. Reserve this for future if we need sub-second latency.**

---

## Recommended Architecture

```
Doctor speaks into microphone
        │
        ▼
Browser MediaRecorder API (captures audio as webm chunks)
        │
        ▼
Edge Function: transcribe-audio (Supabase)
  ├── Sends audio chunk to OpenAI GPT-4o Transcribe API
  │   with medical prompt (drug names, clinical terms, patient context)
  ├── Streams back transcript segments
  └── Returns transcript text
        │
        ▼
Textarea in Prescription Pad / Registration Page
(interim text shown in real-time, final text appended)

FALLBACK: If OpenAI API fails or user has no internet →
          fall back to Web Speech API (existing behavior)
```

---

## Medical Prompt Engineering — The Key Advantage

The biggest improvement over Web Speech API is the **prompt parameter**. With GPT-4o Transcribe, we can send a medical context prompt that dramatically improves recognition of:

### 1. Drug Names (from our 530-drug formulary)

```
Common pediatric drugs that may appear in dictation:
AMOXICILLIN, PARACETAMOL, IBUPROFEN, AZITHROMYCIN, CEFTRIAXONE,
CETIRIZINE, ONDANSETRON, SALBUTAMOL, PREDNISOLONE, METRONIDAZOLE,
AMOXICILLIN+CLAVULANATE, MONTELUKAST, ZINC, ORS, IRON, FOLIC ACID,
DOMPERIDONE, RANITIDINE, OMEPRAZOLE, ALBENDAZOLE, IVERMECTIN,
COTRIMOXAZOLE, FLUCONAZOLE, PHENOBARBITONE, SODIUM VALPROATE,
BUDESONIDE, IPRATROPIUM, LEVOSALBUTAMOL, LACTULOSE, VITAMIN D3
```

### 2. Clinical Terms & Dosing Patterns

```
Medical terms: URTI, LRTI, AOM, AGE, UTI, SAM, MAM, GERD, RDS,
bronchiolitis, pneumonia, pharyngitis, tonsillitis, otitis media,
febrile seizures, neonatal sepsis, jaundice, anemia, malnutrition.

Dosing patterns: mg/kg, mg/kg/day, mg/kg/dose, BD, TDS, QID, OD,
PRN, SOS, nocte, per oral, IV, IM, SC, nebulization, MDI with spacer.

Abbreviations: CBC, CRP, ESR, LFT, RFT, S.Creatinine, TLC, Hb,
SpO2, HR, RR, HC, MUAC, WAZ, HAZ, WHZ, ICD-10, SNOMED.
```

### 3. Hindi Medical Terms (Code-Switching)

```
Hindi medical phrases that may appear mid-sentence:
बुखार (fever), खांसी (cough), जुकाम (cold), दस्त (diarrhea),
उल्टी (vomiting), पेट दर्द (abdominal pain), सांस (breathing),
दवाई (medicine), गोली (tablet), शरबत (syrup), बूंदें (drops),
सुबह शाम (morning evening), खाने के बाद (after food),
खाली पेट (empty stomach), टीका (vaccine), वजन (weight)
```

### 4. Patient-Specific Context (Dynamic)

When a patient is selected in the prescription pad, we can add:

```
Current patient context:
- Patient: Arjun Kumar, 8 months, Male, 7.2 kg
- Known allergies: Penicillin
- Previous diagnoses: Recurrent URTI, Iron deficiency anemia
- Current medications: Ferrous sulfate, Vitamin D3
- Today's complaints: [chief complaints from visit]
```

This makes the model much less likely to hallucinate drug names — it will preferentially recognize terms from the prompt.

---

## Implementation Plan

### Phase 1: Edge Function + Prescription Pad Integration

**New Edge Function: `transcribe-audio`**

```typescript
// POST body: FormData with audio blob + prompt context
// Calls OpenAI GPT-4o Transcribe with medical prompt
// Returns transcript text (optionally streamed)
```

**Prescription Pad Changes:**

1. Add `MediaRecorder` capture alongside existing Web Speech API
2. New "AI Dictate" button next to existing "Dictate" button
3. Record audio in 10-15 second chunks (webm format)
4. Send chunks to `transcribe-audio` Edge Function
5. Append returned text to textarea
6. Show "(AI)" indicator when using OpenAI vs "(Chrome)" for Web Speech

**Fallback:** If Edge Function fails (no API key, network error), automatically fall back to Web Speech API.

### Phase 2: Registration Page

Same pattern for the external records dictation on the registration page.

### Phase 3: Realtime Streaming (Future)

If latency of chunk-based approach is too high, upgrade to OpenAI Realtime API with WebSocket for true real-time transcription.

---

## Cost Estimate

| Scenario                           | Audio/Day | Cost/Day     | Cost/Month      |
| ---------------------------------- | --------- | ------------ | --------------- |
| 20 patients × 2 min dictation each | 40 min    | ₹20 ($0.24)  | ₹600 ($7.20)    |
| 40 patients × 3 min dictation each | 120 min   | ₹60 ($0.72)  | ₹1,800 ($21.60) |
| Peak: 60 patients × 5 min each     | 300 min   | ₹150 ($1.80) | ₹4,500 ($54.00) |

**Verdict:** Very affordable. Even at peak usage, ~₹4,500/month (~$54) for dramatically better medical transcription accuracy.

---

## Secrets Required

```bash
npx supabase secrets set OPENAI_API_KEY=sk-... --project-ref ecywxuqhnlkjtdshpcbc
```

The OpenAI API key is separate from the Anthropic API key already configured for prescription generation.

---

## Comparison Summary

| Feature              | Web Speech API (Current)       | GPT-4o Transcribe (Proposed) |
| -------------------- | ------------------------------ | ---------------------------- |
| Browser support      | Chrome only                    | All browsers (API-based)     |
| Medical vocabulary   | None                           | Full prompt engineering      |
| Hindi code-switching | Basic `en-IN`                  | Excellent multilingual       |
| Drug name accuracy   | Poor                           | High (prompt-seeded)         |
| Dosing patterns      | Poor ("15 mg per kg" → random) | High ("15mg/kg" recognized)  |
| Streaming            | Real-time (good)               | Chunk-based (~5-10s delay)   |
| Cost                 | Free                           | ~₹600-4,500/month            |
| Reliability          | Google can deprecate anytime   | Paid API with SLA            |
| Offline              | Yes (browser-based)            | No (needs internet)          |
| Privacy              | Audio goes to Google           | Audio goes to OpenAI         |

---

## References

- [OpenAI Speech-to-Text Guide](https://developers.openai.com/api/docs/guides/speech-to-text)
- [GPT-4o Transcribe Model](https://developers.openai.com/api/docs/models/gpt-4o-transcribe)
- [OpenAI Next-Gen Audio Models Announcement](https://openai.com/index/introducing-our-next-generation-audio-models/)
- [OpenAI Whisper API Pricing 2026](https://diyai.io/ai-tools/speech-to-text/openai-whisper-api-pricing-2026/)
- [OpenAI Transcribe Pricing](https://costgoat.com/pricing/openai-transcription)
- [Whisper Medical Transcription (MedXcribe)](https://medxcribe.com/how-whisper-technology-enhances-transcription-accuracy/)
- [Wispr Flow for Developers](https://wisprflow.ai/developers)
- [Wispr Flow Review 2026](https://max-productive.ai/ai-tools/wispr-flow/)
- [Best Speech-to-Text APIs 2026 (Deepgram)](https://deepgram.com/learn/best-speech-to-text-apis-2026)
- [Best Speech-to-Text APIs 2026 (AssemblyAI)](https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription)
- [VoiceStreamAI - WebSocket Whisper](https://github.com/alesaccoia/VoiceStreamAI)
- [OpenAI Realtime API](https://developers.openai.com/api/docs/guides/realtime)
- [Whisper Hindi ASR Project](https://github.com/2003HARSH/OpenAI-Whisper-Automated-Hindi-Speech-Recognition)
- [GPT-4o Transcribe Community Feedback](https://community.openai.com/t/gpt-4o-mini-transcribe-and-gpt-4o-transcribe-not-as-good-as-whisper/1153905)
