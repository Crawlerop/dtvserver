import subprocess
import time

if __name__ == "__main__":
    
    '''
    for i in range(5000):
        subprocess.Popen(["curl", f"http://localhost:62541/api/tv/test2/01.m3u8?step={i}", "-v", "-o", "/dev/null"])
        time.sleep(0.25)
    
    time.sleep(10)
    
    for i in range(2000):
        subprocess.Popen(["curl", f"http://localhost:62541/api/tv/test2/01.m3u8?step={i}", "-v", "-o", "/dev/null"])
        #time.sleep(0.25)
        
    time.sleep(10)
    '''
    
    
    for i in range(10000):
        subprocess.Popen(["curl", f"http://localhost:62542/api/tv/test2/2mb.ts?step={i}", "-v", "-o", "/dev/null"])
        time.sleep(0.1)
        
    time.sleep(10)
    
    '''
    for i in range(500):
        subprocess.Popen(["curl", f"http://localhost:62541/api/tv/test2/2mb.ts?step={i}", "-v", "-o", "/dev/null"])
    '''
        #time.sleep(0.25)
