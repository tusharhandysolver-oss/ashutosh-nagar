/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { Mic, Square } from "lucide-react";
import { useSpeechDictation } from "../hooks/useSpeechDictation";

interface Props {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}

// Browser-native voice dictation for a text field - press, speak, the words
// land in the field as you talk (same idea as WhatsApp's mic-to-text), and
// the user can still edit anything by hand afterward. No AI, no API call.
export default function DictateButton({ value, onChange, label = "Dictate" }: Props) {
  const { listening, supported, error, toggle } = useSpeechDictation();

  if (!supported) return null;

  return (
    <span className="dictate-wrap">
      <button
        type="button"
        onClick={() => toggle(value, onChange)}
        aria-pressed={listening}
        title={listening ? "Stop dictating" : `${label} with your voice`}
        className={`dictate-btn ${listening ? "dictate-btn-active" : ""}`}
      >
        {listening && <span className="dictate-ring" />}
        {listening && <span className="dictate-ring dictate-ring-delay" />}
        {listening ? <Square className="h-3 w-3" fill="currentColor" /> : <Mic className="h-3.5 w-3.5" />}
      </button>
      {listening && (
        <span className="dictate-status">
          <span className="dictate-wave"><i /><i /><i /><i /></span>
          Listening…
        </span>
      )}
      {error && <span className="dictate-error">{error}</span>}
    </span>
  );
}
