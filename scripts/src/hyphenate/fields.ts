import protobuf from 'protobufjs';
import type { Long } from 'protobufjs';

export type VarintValue = Long | number | string;
export type ProtoField =
  | { number: number; wire: 0 | 1; value: VarintValue }
  | { number: number; wire: 2; value: Buffer }
  | { number: number; wire: 5; value: number };
export type FieldValue = ProtoField['value'];

export function readFields(buffer: Uint8Array): ProtoField[] {
  const reader = protobuf.Reader.create(buffer);
  const fields: ProtoField[] = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const number = tag >>> 3;
    const wire = tag & 7;
    if (!number) throw Error('Invalid protobuf field number');
    switch (wire) {
      case 0: fields.push({ number, wire, value: reader.uint64() }); break;
      case 1: fields.push({ number, wire, value: reader.fixed64() }); break;
      case 2: fields.push({ number, wire, value: Buffer.from(reader.bytes()) }); break;
      case 5: fields.push({ number, wire, value: reader.fixed32() }); break;
      default: throw Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

export function writeFields(fields: readonly ProtoField[]): Buffer {
  const writer = protobuf.Writer.create();
  for (const field of fields) {
    writer.uint32((field.number << 3) | field.wire);
    switch (field.wire) {
      case 0: writer.uint64(field.value); break;
      case 1: writer.fixed64(field.value); break;
      case 2: writer.bytes(field.value); break;
      case 5: writer.fixed32(field.value); break;
      default: throw Error(`Unsupported protobuf wire type ${(field as ProtoField).wire}`);
    }
  }
  return Buffer.from(writer.finish());
}

export const uintField = (number: number, value: VarintValue | bigint): ProtoField => ({ number, wire: 0, value: String(value) });
export const bytesValue = (number: number, value: Buffer | string): ProtoField =>
  ({ number, wire: 2, value: Buffer.isBuffer(value) ? value : Buffer.from(value) });

export function getField(fields: readonly ProtoField[], number: number): FieldValue | undefined {
  return fields.find(field => field.number === number)?.value;
}

export function bytesField(fields: readonly ProtoField[], number: number): Buffer {
  const value = getField(fields, number);
  if (!Buffer.isBuffer(value)) throw Error(`Missing bytes field ${number}`);
  return value;
}

export function replaceBytes(fields: ProtoField[], number: number, value: Buffer): void {
  const field = fields.find(item => item.number === number && item.wire === 2);
  if (!field) throw Error(`Missing bytes field ${number}`);
  field.value = value;
}

export function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length);
  return Buffer.concat([header, payload]);
}
