/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useRef, useState } from "react";

// Browser-native speech-to-text (Web Speech API) - no external API, no
// network call, nothing sent anywhere. Chrome/Edge ship this as
// webkitSpeechRecognition; there's no shared TS lib type for it, so the
// window lookups below are typed as any on purpose.
function getRecognitionCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function useSpeechDictation() {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  const supported = !!getRecognitionCtor();
  const recognitionRef = useRef<any>(null);
  const baseTextRef = useRef("");
  const finalTranscriptRef = useRef("");

  function stop() {
    recognitionRef.current?.stop();
  }

  function start(currentValue: string, onUpdate: (text: string) => void) {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("Voice dictation isn't supported in this browser.");
      return;
    }
    setError("");
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    baseTextRef.current = currentValue.trim() ? currentValue.trim() + " " : "";
    finalTranscriptRef.current = "";

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript as string;
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      onUpdate((baseTextRef.current + finalTranscriptRef.current + interim).trim());
    };
    recognition.onerror = (event: any) => {
      // "no-speech"/"aborted" fire routinely on pauses - not worth surfacing as an error.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        setError(event.error === "not-allowed" ? "Microphone access was blocked." : "Voice dictation stopped unexpectedly.");
      }
      setListening(false);
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setError("Could not start voice dictation.");
    }
  }

  function toggle(currentValue: string, onUpdate: (text: string) => void) {
    if (listening) stop();
    else start(currentValue, onUpdate);
  }

  return { listening, supported, error, start, stop, toggle };
}
