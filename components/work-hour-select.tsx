// Created by Cory McCabe
'use client';

import { NativeSelect } from '@/components/ui/native-select';

const workHours = Array.from({ length: 48 }, (_, index) =>
  `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`,
);

function timeLabel(value: string) {
  const [hour, minute] = value.split(':');
  const hours = Number(hour);
  return `${hours % 12 || 12}:${minute} ${hours < 12 ? 'AM' : 'PM'}`;
}

export default function WorkHourSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect
      required
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {/* Preserve older saved times until the user explicitly chooses a new one. */}
      {!workHours.includes(value) && (
        <option value={value} disabled>
          {timeLabel(value)} (current)
        </option>
      )}
      {workHours.map((time) => (
        <option key={time} value={time}>
          {timeLabel(time)}
        </option>
      ))}
    </NativeSelect>
  );
}
