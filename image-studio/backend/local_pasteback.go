package backend

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"math"
	"os"
	"path/filepath"
)

// PasteLocalEdit composites an edited crop onto the original source image.
// It runs in the desktop process so a large source image never has to become
// a browser Canvas or a long-lived base64 value.
func (s *Service) PasteLocalEdit(sourcePath, editedPath string, options PlanarPastebackOptions) (ImageTransformResult, error) {
	allowedSource, err := s.ensureManagedReadablePath(sourcePath, managedImageFile)
	if err != nil {
		return ImageTransformResult{}, err
	}
	allowedEdited, err := s.ensureManagedReadablePath(editedPath, managedImageFile)
	if err != nil {
		return ImageTransformResult{}, err
	}
	if options.CropWidth <= 0 || options.CropHeight <= 0 {
		return ImageTransformResult{}, errors.New("pasteback crop rect must have positive size")
	}
	ctx, finishOperation, err := s.beginOperation(false)
	if err != nil {
		return ImageTransformResult{}, err
	}
	defer finishOperation()
	releaseMedia, err := s.acquireMediaSlot(ctx)
	if err != nil {
		return ImageTransformResult{}, err
	}
	defer releaseMedia()

	source, err := loadImage(allowedSource)
	if err != nil {
		return ImageTransformResult{}, err
	}
	edited, err := loadImage(allowedEdited)
	if err != nil {
		return ImageTransformResult{}, err
	}
	sourceBounds := source.Bounds()
	editedBounds := edited.Bounds()
	if sourceBounds.Dx() <= 0 || sourceBounds.Dy() <= 0 || editedBounds.Dx() <= 0 || editedBounds.Dy() <= 0 {
		return ImageTransformResult{}, errors.New("pasteback image dimensions are invalid")
	}
	if sourceBounds.Dx() > 16_384 || sourceBounds.Dy() > 16_384 || int64(sourceBounds.Dx())*int64(sourceBounds.Dy()) > 100_000_000 {
		return ImageTransformResult{}, fmt.Errorf("原图尺寸 %dx%d 超过桌面贴回上限", sourceBounds.Dx(), sourceBounds.Dy())
	}
	if editedBounds.Dx() > 16_384 || editedBounds.Dy() > 16_384 || int64(editedBounds.Dx())*int64(editedBounds.Dy()) > 64_000_000 {
		return ImageTransformResult{}, fmt.Errorf("编辑图尺寸 %dx%d 超过局部贴回上限", editedBounds.Dx(), editedBounds.Dy())
	}

	mask, err := decodePastebackMask(options.MaskB64)
	if err != nil {
		return ImageTransformResult{}, err
	}
	output := image.NewRGBA(image.Rect(0, 0, sourceBounds.Dx(), sourceBounds.Dy()))
	draw.Draw(output, output.Bounds(), source, sourceBounds.Min, draw.Src)
	composePlanarImage(output, edited, mask, options)
	out, err := prepareTransformOutput(allowedSource, "local-pasteback")
	if err != nil {
		return ImageTransformResult{}, err
	}
	out.Path = filepath.Join(filepath.Dir(out.Path), filepath.Base(out.Path[:len(out.Path)-len(filepath.Ext(out.Path))]+".png"))
	out.Format = "png"
	result, err := saveTransform(output, out, "desktop-disk")
	if err != nil {
		_ = os.Remove(out.Path)
		return ImageTransformResult{}, err
	}
	return result, nil
}

func decodePastebackMask(raw string) (image.Image, error) {
	if raw == "" {
		return nil, nil
	}
	data, err := base64.StdEncoding.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("蒙版数据无效: %w", err)
	}
	if len(data) > 50*1024*1024 {
		return nil, errors.New("蒙版数据过大，请缩小贴回区域后重试")
	}
	decoded, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("蒙版数据无法读取: %w", err)
	}
	return decoded, nil
}

func composePlanarImage(output *image.RGBA, edited image.Image, mask image.Image, options PlanarPastebackOptions) {
	width := float64(maxInt(1, options.CropWidth))
	height := float64(maxInt(1, options.CropHeight))
	scale := options.Scale
	if !isFinite(scale) || scale < 0.05 {
		scale = 1
	}
	centerX := float64(options.CropX) + width*(0.5+finiteOrZero(options.OffsetXRatio))
	centerY := float64(options.CropY) + height*(0.5+finiteOrZero(options.OffsetYRatio))
	angle := -finiteOrZero(options.RotationDeg) * math.Pi / 180
	cosine, sine := math.Cos(angle), math.Sin(angle)
	overlayWidth, overlayHeight := width*scale, height*scale
	radius := math.Hypot(overlayWidth, overlayHeight)*0.5 + 2
	minX := maxInt(0, int(math.Floor(centerX-radius)))
	maxX := minInt(output.Bounds().Dx(), int(math.Ceil(centerX+radius)))
	minY := maxInt(0, int(math.Floor(centerY-radius)))
	maxY := minInt(output.Bounds().Dy(), int(math.Ceil(centerY+radius)))
	feather := clampFloat(options.FeatherFraction, 0, 0.5)
	for y := minY; y < maxY; y++ {
		for x := minX; x < maxX; x++ {
			dx, dy := float64(x)+0.5-centerX, float64(y)+0.5-centerY
			rx, ry := dx*cosine-dy*sine, dx*sine+dy*cosine
			u := rx/(width*scale) + 0.5
			v := ry/(height*scale) + 0.5
			if u < 0 || u > 1 || v < 0 || v > 1 {
				continue
			}
			r, g, b, a := sampleImageRGBA(edited, u, v)
			alpha := float64(a) / 255
			if mask != nil {
				alpha *= maskAlphaAt(mask, u, v, options.MaskFeatherPx)
			}
			edge := math.Min(math.Min(u, 1-u), math.Min(v, 1-v))
			if feather > 0 {
				alpha *= clampFloat(edge/feather, 0, 1)
			}
			if alpha <= 0.000001 {
				continue
			}
			r, g, b = adjustPastebackColor(r, g, b, options)
			index := output.PixOffset(x, y)
			output.Pix[index] = uint8(float64(r)*alpha + float64(output.Pix[index])*(1-alpha))
			output.Pix[index+1] = uint8(float64(g)*alpha + float64(output.Pix[index+1])*(1-alpha))
			output.Pix[index+2] = uint8(float64(b)*alpha + float64(output.Pix[index+2])*(1-alpha))
			output.Pix[index+3] = 255
		}
	}
}

func maskAlphaAt(mask image.Image, u, v, featherPx float64) float64 {
	if featherPx <= 0 {
		_, _, _, alpha := sampleImageRGBA(mask, u, v)
		return float64(alpha) / 255
	}
	bounds := mask.Bounds()
	radiusX := featherPx / float64(maxInt(1, bounds.Dx()))
	radiusY := featherPx / float64(maxInt(1, bounds.Dy()))
	total := 0.0
	count := 0.0
	for _, offset := range [][2]float64{{-radiusX, -radiusY}, {0, -radiusY}, {radiusX, -radiusY}, {-radiusX, 0}, {0, 0}, {radiusX, 0}, {-radiusX, radiusY}, {0, radiusY}, {radiusX, radiusY}} {
		_, _, _, alpha := sampleImageRGBA(mask, u+offset[0], v+offset[1])
		total += float64(alpha) / 255
		count++
	}
	return total / count
}

func sampleImageRGBA(source image.Image, u, v float64) (uint8, uint8, uint8, uint8) {
	bounds := source.Bounds()
	x := clampFloat(u, 0, 1) * float64(maxInt(1, bounds.Dx()-1))
	y := clampFloat(v, 0, 1) * float64(maxInt(1, bounds.Dy()-1))
	x0, y0 := int(math.Floor(x)), int(math.Floor(y))
	x1, y1 := minInt(bounds.Dx()-1, x0+1), minInt(bounds.Dy()-1, y0+1)
	fx, fy := x-float64(x0), y-float64(y0)
	points := [4]color.RGBA{}
	for index, point := range [][2]int{{x0, y0}, {x1, y0}, {x0, y1}, {x1, y1}} {
		r, g, b, a := source.At(bounds.Min.X+point[0], bounds.Min.Y+point[1]).RGBA()
		points[index] = color.RGBA{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8), uint8(a >> 8)}
	}
	values := [4]float64{}
	for channel := 0; channel < 4; channel++ {
		top := float64(channelValue(points[0], channel))*(1-fx) + float64(channelValue(points[1], channel))*fx
		bottom := float64(channelValue(points[2], channel))*(1-fx) + float64(channelValue(points[3], channel))*fx
		values[channel] = top*(1-fy) + bottom*fy
	}
	return uint8(clampFloat(values[0], 0, 255)), uint8(clampFloat(values[1], 0, 255)), uint8(clampFloat(values[2], 0, 255)), uint8(clampFloat(values[3], 0, 255))
}

func channelValue(value color.RGBA, channel int) uint8 {
	switch channel {
	case 0:
		return value.R
	case 1:
		return value.G
	case 2:
		return value.B
	default:
		return value.A
	}
}

func adjustPastebackColor(r, g, b uint8, options PlanarPastebackOptions) (uint8, uint8, uint8) {
	brightness := options.Brightness
	if !isFinite(brightness) || brightness == 0 {
		brightness = 1
	}
	contrast := options.Contrast
	if !isFinite(contrast) || contrast == 0 {
		contrast = 1
	}
	adjust := func(value uint8) float64 { return clampFloat((float64(value)*brightness-128)*contrast+128, 0, 255) }
	rf, gf, bf := adjust(r), adjust(g), adjust(b)
	hue := finiteOrZero(options.HueRotationDeg) * math.Pi / 180
	if math.Abs(hue) > 1e-6 {
		cosine, sine := math.Cos(hue), math.Sin(hue)
		rf, gf, bf =
			(0.213+cosine*0.787-sine*0.213)*rf+(0.715-cosine*0.715-sine*0.715)*gf+(0.072-cosine*0.072+sine*0.928)*bf,
			(0.213-cosine*0.213+sine*0.143)*rf+(0.715+cosine*0.285+sine*0.140)*gf+(0.072-cosine*0.072-sine*0.283)*bf,
			(0.213-cosine*0.213-sine*0.787)*rf+(0.715-cosine*0.715+sine*0.715)*gf+(0.072+cosine*0.928+sine*0.072)*bf
	}
	return uint8(clampFloat(rf, 0, 255)), uint8(clampFloat(gf, 0, 255)), uint8(clampFloat(bf, 0, 255))
}

func finiteOrZero(value float64) float64 {
	if !isFinite(value) {
		return 0
	}
	return value
}

func isFinite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func clampFloat(value, min, max float64) float64 {
	if !isFinite(value) {
		return min
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
