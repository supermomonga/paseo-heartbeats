import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

export const MONOSPACE = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

export function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(() => {
    const { colors } = theme;
    const input = {
      color: colors.foreground,
      backgroundColor: colors.surface1,
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 8,
      fontSize: 13,
    };
    return StyleSheet.create({
      screen: { flex: 1, backgroundColor: colors.surface0 },
      content: { padding: compact ? 12 : 16, gap: 16 },
      section: { gap: 8 },
      sectionTitle: {
        color: colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600",
        letterSpacing: 0.5,
        textTransform: "uppercase",
      },
      text: { color: colors.foreground, fontSize: 13 },
      title: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
      muted: { color: colors.foregroundMuted, fontSize: 12 },
      danger: { color: colors.statusDanger, fontSize: 12 },
      mono: { color: colors.foreground, fontSize: 12, fontFamily: MONOSPACE },
      label: { color: colors.foreground, fontSize: 12, fontWeight: "600" },
      field: { gap: 4 },
      input,
      monoInput: { ...input, fontFamily: MONOSPACE },
      promptInput: { ...input, minHeight: 160, maxHeight: 420, textAlignVertical: "top" },
      row: { flexDirection: "row", alignItems: "center", gap: 8 },
      wrapRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
      card: {
        gap: 6,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      listItem: {
        gap: 2,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
      },
      listItemSelected: { backgroundColor: colors.surface2 },
      detailRow: { flexDirection: "row", gap: 8 },
      detailKey: { color: colors.foregroundMuted, fontSize: 12, width: 96 },
      detailValue: { color: colors.foreground, fontSize: 12, flex: 1 },
    });
  }, [theme, compact]);
}

export type Styles = ReturnType<typeof useStyles>;

type ButtonVariant = "primary" | "secondary" | "danger";

export function Button({
  theme,
  label,
  icon,
  variant = "secondary",
  disabled = false,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  icon?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
  onPress(): void;
}) {
  const { colors } = theme;
  // Danger stays outlined so its text keeps contrast in every theme.
  const background = variant === "primary" ? colors.accent : "transparent";
  const foreground =
    variant === "primary"
      ? colors.accentForeground
      : variant === "danger"
        ? colors.statusDanger
        : colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: variant === "primary" ? 0 : 1,
        borderColor: variant === "danger" ? colors.statusDanger : colors.border,
        backgroundColor: background,
        opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
      })}
    >
      {icon ? <Icon name={icon} size={14} color={foreground} /> : null}
      <Text style={{ color: foreground, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

export function statusColor(theme: PluginTheme, status: string): string {
  switch (status) {
    case "active":
    case "succeeded":
      return theme.colors.statusSuccess;
    case "paused":
      return theme.colors.statusWarning;
    case "failed":
      return theme.colors.statusDanger;
    case "running":
      return theme.colors.accent;
    default:
      return theme.colors.foregroundMuted;
  }
}

export function StatusDot({ theme, status }: { theme: PluginTheme; status: string }) {
  return (
    <View
      style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: statusColor(theme, status) }}
    />
  );
}
