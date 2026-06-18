## Relay Mechanism
  
Each device relays the packets it receives, if the value of the TTL has not reached zero.  
  
The maximum number of relays is 255. If you use this value when sending a packet, it means it will pass through 255 devices (potentially multiple times the same device). At Long Range 125 kb/s, we can reach an average distance of up to 200 meters. 255 x 200 = 51,000 meters (51 km). But sometimes, we don't need to go that far; just a few hundred meters is enough, or 1-2 km. In this case, it's advisable to use a low TTL value (10-15) to avoid unnecessarily overloading the network.  
  
Even if the device has already received a package, it still returns it. On the other hand, if the device has already processed a package (so in its database) then it does not reprocess it a second time.  
  
The relayed packages follow the same logical ELODRI as the acknowledgement mechanism.  
  
The last 1000 *(by default)* packages Message recieved are kept in RAM, for the `MISSING` part of the acknowledgement mechanism. 1000 packages represent 1000 x 31 bytes = 31 000 bytes = minimum 31 kb in the RAM.  
