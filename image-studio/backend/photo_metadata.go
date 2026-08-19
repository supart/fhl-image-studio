package backend

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
)

const maxPhotoMetadataReadBytes int64 = 2 * 1024 * 1024

func readPhotoMetadata(path string) (*PhotoMetadata, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxPhotoMetadataReadBytes))
	if err != nil {
		return nil, err
	}
	width, height := 0, 0
	if cfg, cfgErr := imageConfig(path); cfgErr == nil {
		width, height = cfg.Width, cfg.Height
	}
	return parsePhotoMetadata(data, width, height), nil
}

func parsePhotoMetadata(data []byte, width, height int) *PhotoMetadata {
	metadata := &PhotoMetadata{Width: width, Height: height}
	if len(data) >= 2 && data[0] == 0xff && data[1] == 0xd8 {
		parseJPEGExif(data, metadata)
	}
	return metadata
}

func parseJPEGExif(data []byte, metadata *PhotoMetadata) {
	for offset := 2; offset+4 <= len(data); {
		if data[offset] != 0xff {
			offset++
			continue
		}
		for offset < len(data) && data[offset] == 0xff {
			offset++
		}
		if offset >= len(data) {
			return
		}
		marker := data[offset]
		offset++
		if marker == 0xda || marker == 0xd9 {
			return
		}
		if marker == 0xd8 || marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7) {
			continue
		}
		if offset+2 > len(data) {
			return
		}
		segmentLength := int(binary.BigEndian.Uint16(data[offset : offset+2]))
		if segmentLength < 2 || offset+segmentLength > len(data) {
			return
		}
		segment := data[offset+2 : offset+segmentLength]
		if marker == 0xe1 && len(segment) >= 8 && bytes.Equal(segment[:6], []byte("Exif\x00\x00")) {
			parseTIFF(segment[6:], metadata)
			return
		}
		offset += segmentLength
	}
}

type tiffReader struct {
	data   []byte
	little bool
}

func (r tiffReader) u16(offset int) (uint16, bool) {
	if offset < 0 || offset+2 > len(r.data) {
		return 0, false
	}
	if r.little {
		return binary.LittleEndian.Uint16(r.data[offset : offset+2]), true
	}
	return binary.BigEndian.Uint16(r.data[offset : offset+2]), true
}

func (r tiffReader) u32(offset int) (uint32, bool) {
	if offset < 0 || offset+4 > len(r.data) {
		return 0, false
	}
	if r.little {
		return binary.LittleEndian.Uint32(r.data[offset : offset+4]), true
	}
	return binary.BigEndian.Uint32(r.data[offset : offset+4]), true
}

func parseTIFF(data []byte, metadata *PhotoMetadata) {
	if len(data) < 8 {
		return
	}
	little := bytes.Equal(data[:2], []byte("II"))
	if !little && !bytes.Equal(data[:2], []byte("MM")) {
		return
	}
	reader := tiffReader{data: data, little: little}
	magic, ok := reader.u16(2)
	if !ok || magic != 42 {
		return
	}
	ifdOffset, ok := reader.u32(4)
	if !ok {
		return
	}
	parseTIFFIFD(reader, int(ifdOffset), metadata, 0, false)
}

func parseTIFFIFD(reader tiffReader, offset int, metadata *PhotoMetadata, depth int, exifIFD bool) {
	if depth > 2 {
		return
	}
	count, ok := reader.u16(offset)
	if !ok {
		return
	}
	entryOffset := offset + 2
	for index := 0; index < int(count); index++ {
		entry := entryOffset + index*12
		if entry+12 > len(reader.data) {
			return
		}
		tag, tagOK := reader.u16(entry)
		typeID, typeOK := reader.u16(entry + 2)
		valueCount, countOK := reader.u32(entry + 4)
		if !tagOK || !typeOK || !countOK {
			continue
		}
		value, valueOK := tiffValue(reader, entry+8, typeID, valueCount)
		if !valueOK {
			continue
		}
		switch tag {
		case 0x010f:
			metadata.CameraMake = tiffASCII(value)
		case 0x0110:
			metadata.CameraModel = tiffASCII(value)
		case 0x0131:
			metadata.Software = tiffASCII(value)
		case 0x0132, 0x9003:
			if metadata.CapturedAt == "" {
				metadata.CapturedAt = tiffASCII(value)
			}
		case 0x0112:
			metadata.Orientation = orientationLabel(tiffUnsigned(value, typeID, reader))
		case 0x8769:
			if pointer := tiffUnsigned(value, typeID, reader); pointer > 0 {
				parseTIFFIFD(reader, int(pointer), metadata, depth+1, true)
			}
		case 0xa434:
			metadata.LensModel = tiffASCII(value)
		case 0x8827:
			if metadata.ISO == "" {
				metadata.ISO = tiffIntegerString(value, typeID, reader)
			}
		case 0x829a:
			metadata.ShutterSpeed = tiffExposure(value, reader)
		case 0x829d:
			metadata.Aperture = tiffAperture(value, reader)
		case 0x920a:
			metadata.FocalLength = tiffFocalLength(value, reader)
		}
	}
	_ = exifIFD
}

func tiffValue(reader tiffReader, inlineOffset int, typeID uint16, count uint32) ([]byte, bool) {
	unitSize := map[uint16]int{1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1}[typeID]
	if unitSize == 0 || count == 0 || count > uint32(len(reader.data)) {
		return nil, false
	}
	size := unitSize * int(count)
	if size <= 4 {
		if inlineOffset+size > len(reader.data) {
			return nil, false
		}
		return reader.data[inlineOffset : inlineOffset+size], true
	}
	offset, ok := reader.u32(inlineOffset)
	if !ok || int(offset) < 0 || int(offset)+size > len(reader.data) {
		return nil, false
	}
	return reader.data[int(offset) : int(offset)+size], true
}

func tiffASCII(value []byte) string {
	return strings.TrimSpace(strings.TrimRight(string(value), "\x00"))
}

func tiffUnsigned(value []byte, typeID uint16, reader tiffReader) uint32 {
	if typeID == 3 && len(value) >= 2 {
		if reader.little {
			return uint32(binary.LittleEndian.Uint16(value[:2]))
		}
		return uint32(binary.BigEndian.Uint16(value[:2]))
	}
	if typeID == 4 && len(value) >= 4 {
		if reader.little {
			return binary.LittleEndian.Uint32(value[:4])
		}
		return binary.BigEndian.Uint32(value[:4])
	}
	return 0
}

func tiffIntegerString(value []byte, typeID uint16, reader tiffReader) string {
	if typeID == 2 {
		return tiffASCII(value)
	}
	if number := tiffUnsigned(value, typeID, reader); number > 0 {
		return strconv.FormatUint(uint64(number), 10)
	}
	return ""
}

func tiffRational(value []byte, reader tiffReader) (float64, bool) {
	if len(value) < 8 {
		return 0, false
	}
	var numerator, denominator uint32
	if reader.little {
		numerator = binary.LittleEndian.Uint32(value[:4])
		denominator = binary.LittleEndian.Uint32(value[4:8])
	} else {
		numerator = binary.BigEndian.Uint32(value[:4])
		denominator = binary.BigEndian.Uint32(value[4:8])
	}
	if denominator == 0 {
		return 0, false
	}
	return float64(numerator) / float64(denominator), true
}

func tiffExposure(value []byte, reader tiffReader) string {
	numerator, denominator := tiffRationalParts(value, reader)
	if denominator == 0 || numerator == 0 {
		return ""
	}
	if numerator == 1 {
		return fmt.Sprintf("1/%d s", denominator)
	}
	return fmt.Sprintf("%.3g s", float64(numerator)/float64(denominator))
}

func tiffAperture(value []byte, reader tiffReader) string {
	if number, ok := tiffRational(value, reader); ok && number > 0 {
		return fmt.Sprintf("f/%.1f", number)
	}
	return ""
}

func tiffFocalLength(value []byte, reader tiffReader) string {
	if number, ok := tiffRational(value, reader); ok && number > 0 {
		return fmt.Sprintf("%.0f mm", number)
	}
	return ""
}

func tiffRationalParts(value []byte, reader tiffReader) (uint32, uint32) {
	if len(value) < 8 {
		return 0, 0
	}
	if reader.little {
		return binary.LittleEndian.Uint32(value[:4]), binary.LittleEndian.Uint32(value[4:8])
	}
	return binary.BigEndian.Uint32(value[:4]), binary.BigEndian.Uint32(value[4:8])
}

func orientationLabel(value uint32) string {
	switch value {
	case 1:
		return "正常"
	case 3:
		return "旋转 180°"
	case 6:
		return "顺时针 90°"
	case 8:
		return "逆时针 90°"
	case 2:
		return "水平翻转"
	case 4:
		return "垂直翻转"
	case 5:
		return "水平翻转后顺时针 90°"
	case 7:
		return "水平翻转后逆时针 90°"
	default:
		return ""
	}
}
