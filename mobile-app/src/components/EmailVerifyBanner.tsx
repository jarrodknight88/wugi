// ─────────────────────────────────────────────────────────────────────
// Wugi — EmailVerifyBanner
// Soft-gate banner shown above tabs when the signed-in user has not yet
// verified their email. Hidden for guest (anonymous) users and users who
// have already verified.
// ─────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFirebase } from '../context/FirebaseContext';

const COOLDOWN_MS = 60_000;

// Module-level cooldown timestamp survives unmount/remount (e.g. tab swap),
// so navigating away and back does not reset the 60s window.
let lastSentAt = 0;

type Status = 'idle' | 'sending' | 'sent' | 'checking' | 'unverified' | 'error';

export function EmailVerifyBanner() {
  const { user, resendVerificationEmail, refreshEmailVerified } = useFirebase();

  const [status,    setStatus]    = useState<Status>('idle');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Recompute remaining cooldown whenever banner mounts and on every tick
  useEffect(() => {
    const computeRemaining = () => {
      const elapsed = Date.now() - lastSentAt;
      const remaining = Math.max(0, Math.ceil((COOLDOWN_MS - elapsed) / 1000));
      setSecondsLeft(remaining);
      return remaining;
    };

    if (computeRemaining() > 0) {
      tickRef.current = setInterval(() => {
        if (computeRemaining() <= 0 && tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
      }, 1000);
    }

    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [status]);

  if (!user || user.isAnonymous || user.emailVerified) return null;

  const onResend = async () => {
    if (secondsLeft > 0 || status === 'sending') return;
    setStatus('sending');
    try {
      await resendVerificationEmail();
      lastSentAt = Date.now();
      setSecondsLeft(Math.ceil(COOLDOWN_MS / 1000));
      setStatus('sent');
    } catch {
      setStatus('error');
    }
  };

  const onCheck = async () => {
    if (status === 'checking') return;
    setStatus('checking');
    try {
      const verified = await refreshEmailVerified();
      // If verified, banner returns null on the next render — nothing else to do.
      if (!verified) setStatus('unverified');
    } catch {
      setStatus('error');
    }
  };

  const resendDisabled = secondsLeft > 0 || status === 'sending';
  const resendLabel = status === 'sending'
    ? 'Sending…'
    : secondsLeft > 0
      ? `Resend in ${secondsLeft}s`
      : 'Resend';

  const feedback =
    status === 'sent'       ? 'Verification email sent — check your inbox.' :
    status === 'unverified' ? 'Not verified yet — check your inbox.' :
    status === 'error'      ? 'Something went wrong. Try again.' :
    null;

  return (
    <View style={{
      backgroundColor: '#fef3c7',
      borderBottomWidth: 1,
      borderBottomColor: '#fcd34d',
      paddingTop: 52, // clears iOS status bar; sits above tabs
      paddingHorizontal: 16,
      paddingBottom: 12,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ fontSize: 18 }}>✉️</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#92400e', fontSize: 13, fontWeight: '700' }}>
            Verify your email
          </Text>
          <Text style={{ color: '#92400e', fontSize: 12, marginTop: 1 }}>
            Check your inbox to confirm your account.
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        <TouchableOpacity
          onPress={onResend}
          disabled={resendDisabled}
          style={{
            flex: 1,
            backgroundColor: resendDisabled ? '#fde68a' : '#92400e',
            borderRadius: 8,
            paddingVertical: 9,
            alignItems: 'center',
            opacity: resendDisabled && status !== 'sending' ? 0.85 : 1,
          }}
        >
          {status === 'sending'
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={{
                color: resendDisabled ? '#92400e' : '#fff',
                fontSize: 13,
                fontWeight: '700',
              }}>{resendLabel}</Text>}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onCheck}
          disabled={status === 'checking'}
          style={{
            flex: 1,
            borderRadius: 8,
            paddingVertical: 9,
            alignItems: 'center',
            borderWidth: 1.5,
            borderColor: '#92400e',
            backgroundColor: 'transparent',
          }}
        >
          {status === 'checking'
            ? <ActivityIndicator size="small" color="#92400e" />
            : <Text style={{ color: '#92400e', fontSize: 13, fontWeight: '700' }}>
                I've verified
              </Text>}
        </TouchableOpacity>
      </View>

      {feedback && (
        <Text style={{
          color: '#92400e',
          fontSize: 11,
          fontWeight: '600',
          marginTop: 8,
          textAlign: 'center',
        }}>
          {feedback}
        </Text>
      )}
    </View>
  );
}
