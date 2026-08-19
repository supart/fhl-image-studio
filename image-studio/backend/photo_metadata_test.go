package backend

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestParsePhotoMetadataReadsCameraExifFields(t *testing.T) {
	tiff := make([]byte, 280)
	copy(tiff[:2], []byte("II"))
	binary.LittleEndian.PutUint16(tiff[2:4], 42)
	binary.LittleEndian.PutUint32(tiff[4:8], 8)
	binary.LittleEndian.PutUint16(tiff[8:10], 4)
	putASCIIEntry(tiff, 10, 0x010f, 100, "SONY")
	putASCIIEntry(tiff, 22, 0x0110, 108, "A7R V")
	putASCIIEntry(tiff, 34, 0x0131, 116, "Studio")
	putLongEntry(tiff, 46, 0x8769, 140)
	copy(tiff[100:], []byte("SONY\x00"))
	copy(tiff[108:], []byte("A7R V\x00"))
	copy(tiff[116:], []byte("Studio\x00"))
	binary.LittleEndian.PutUint16(tiff[140:142], 5)
	putASCIIEntry(tiff, 142, 0x9003, 208, "2024:08:19 12:34:56")
	putShortEntry(tiff, 154, 0x8827, 100)
	putRationalEntry(tiff, 166, 0x829a, 230, 1, 125)
	putRationalEntry(tiff, 178, 0x829d, 238, 28, 10)
	putRationalEntry(tiff, 190, 0x920a, 246, 50, 1)
	copy(tiff[208:], []byte("2024:08:19 12:34:56\x00"))

	segment := append([]byte("Exif\x00\x00"), tiff...)
	jpeg := bytes.NewBuffer([]byte{0xff, 0xd8, 0xff, 0xe1, byte((len(segment) + 2) >> 8), byte(len(segment) + 2)})
	jpeg.Write(segment)
	jpeg.Write([]byte{0xff, 0xd9})
	metadata := parsePhotoMetadata(jpeg.Bytes(), 9504, 6336)
	if metadata.CameraMake != "SONY" || metadata.CameraModel != "A7R V" {
		t.Fatalf("camera metadata = %+v", metadata)
	}
	if metadata.CapturedAt != "2024:08:19 12:34:56" || metadata.ISO != "100" {
		t.Fatalf("capture metadata = %+v", metadata)
	}
	if metadata.ShutterSpeed != "1/125 s" || metadata.Aperture != "f/2.8" || metadata.FocalLength != "50 mm" {
		t.Fatalf("lens metadata = %+v", metadata)
	}
	if metadata.Width != 9504 || metadata.Height != 6336 {
		t.Fatalf("dimensions = %dx%d", metadata.Width, metadata.Height)
	}
}

func TestParsePhotoMetadataKeepsDimensionsWithoutExif(t *testing.T) {
	metadata := parsePhotoMetadata([]byte{0xff, 0xd8, 0xff, 0xd9}, 12000, 8000)
	if metadata.Width != 12000 || metadata.Height != 8000 {
		t.Fatalf("dimensions = %dx%d", metadata.Width, metadata.Height)
	}
	if metadata.CameraMake != "" || metadata.CameraModel != "" || metadata.ISO != "" {
		t.Fatalf("unexpected EXIF metadata: %+v", metadata)
	}
}

func putASCIIEntry(data []byte, offset int, tag uint16, valueOffset uint32, value string) {
	binary.LittleEndian.PutUint16(data[offset:offset+2], tag)
	binary.LittleEndian.PutUint16(data[offset+2:offset+4], 2)
	binary.LittleEndian.PutUint32(data[offset+4:offset+8], uint32(len(value)+1))
	binary.LittleEndian.PutUint32(data[offset+8:offset+12], valueOffset)
}

func putLongEntry(data []byte, offset int, tag uint16, value uint32) {
	binary.LittleEndian.PutUint16(data[offset:offset+2], tag)
	binary.LittleEndian.PutUint16(data[offset+2:offset+4], 4)
	binary.LittleEndian.PutUint32(data[offset+4:offset+8], 1)
	binary.LittleEndian.PutUint32(data[offset+8:offset+12], value)
}

func putShortEntry(data []byte, offset int, tag uint16, value uint16) {
	binary.LittleEndian.PutUint16(data[offset:offset+2], tag)
	binary.LittleEndian.PutUint16(data[offset+2:offset+4], 3)
	binary.LittleEndian.PutUint32(data[offset+4:offset+8], 1)
	binary.LittleEndian.PutUint16(data[offset+8:offset+10], value)
}

func putRationalEntry(data []byte, offset int, tag uint16, valueOffset, numerator, denominator uint32) {
	binary.LittleEndian.PutUint16(data[offset:offset+2], tag)
	binary.LittleEndian.PutUint16(data[offset+2:offset+4], 5)
	binary.LittleEndian.PutUint32(data[offset+4:offset+8], 1)
	binary.LittleEndian.PutUint32(data[offset+8:offset+12], valueOffset)
	putRational(data, int(valueOffset), numerator, denominator)
}

func putRational(data []byte, offset int, numerator, denominator uint32) {
	binary.LittleEndian.PutUint32(data[offset:offset+4], numerator)
	binary.LittleEndian.PutUint32(data[offset+4:offset+8], denominator)
}
