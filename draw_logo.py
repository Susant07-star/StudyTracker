import sys
try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("PIL not available")
    sys.exit(1)

def create_logo():
    size = 256
    # background (transparent or slate 900)
    # Using transparent so it works well as desktop icon and favicon
    img = Image.new('RGBA', (size, size), (15, 23, 42, 0)) 
    
    # Create an inner background with rounded corners
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((10, 10, 246, 246), radius=50, fill=(15, 23, 42, 255))
    
    # Left hemisphere - Indigo
    draw.ellipse((40, 50, 120, 190), fill=(99, 102, 241, 200)) 
    # Right hemisphere - Pink
    draw.ellipse((136, 50, 216, 190), fill=(236, 72, 153, 200)) 
    # Center connection
    draw.ellipse((90, 40, 166, 210), fill=(99, 102, 241, 180)) 

    # S for StudyTracker
    try:
        font = ImageFont.truetype("segoeui.ttf", 130)
    except:
        font = ImageFont.load_default()
        
    draw.text((128, 115), "S", fill=(255, 255, 255, 255), font=font, anchor="mm")
    draw.text((128, 150), "T", fill=(255, 255, 255, 255), font=font, anchor="mm")

    # save png
    img.save('logo.png')
    
    # save ico with multiple sizes included
    img.save('favicon.ico', format='ICO', sizes=[(256, 256), (128,128), (64,64), (32,32), (16,16)])

if __name__ == '__main__':
    create_logo()
    print("Logo created successfully")
